using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Content.Shared._MAC.CCVar;
using Robust.Shared.Configuration;
using Robust.Shared.Log;
using Robust.Shared.Network;

namespace Content.Server._MAC.GuestAuth;

public enum MACChallengeState
{
    None,
    ChallengePending,
    // /consume returned 409 (not_ready, identity_unresolved, awaiting_selection, awaiting_merge)
    PendingNotReady,
    JustConsumed,
    // challenge expired, 404/410 from API, or 400 username mismatch
    ExpiredOrInvalid,
    // 401/403 or unrecoverable HTTP error
    ApiError,
}

/// <summary>
/// Handles MAC (Myzumi's App Center) guest identity challenges.
/// Calls /api/auth-challenge/start and /api/auth-challenge/consume.
/// checkToken is kept strictly inside this class and never exposed.
/// </summary>
public sealed class MACAuthManager
{
    [Dependency] private readonly IConfigurationManager _cfg = default!;
    [Dependency] private readonly ILogManager _log = default!;

    private ISawmill? _sawmill;
    private ISawmill Log => _sawmill ??= _log.GetSawmill("mac.auth");

    private readonly HttpClient _http = new();

    private readonly Dictionary<string, PendingChallenge> _pending = new();
    private readonly Dictionary<string, VerifiedMapping> _verified = new();

    public bool IsGuestUsername(string raw)
    {
        return raw.StartsWith("guest@", StringComparison.OrdinalIgnoreCase)
            || raw.StartsWith("localhost@", StringComparison.OrdinalIgnoreCase);
    }

    // Strips prefix and lowercases — used as the dictionary key.
    public string NormalizeUsername(string raw)
    {
        var name = StripGuestPrefix(raw);
        return name.ToLowerInvariant();
    }

    public MACChallengeState GetChallengeState(string normalized)
    {
        var now = DateTimeOffset.UtcNow;

        if (_verified.TryGetValue(normalized, out var vm) && vm.ExpiresAt > now)
            return MACChallengeState.JustConsumed;

        if (!_pending.TryGetValue(normalized, out var ch))
            return MACChallengeState.None;

        if (ch.ExpiresAt <= now)
        {
            ch.State = MACChallengeState.ExpiredOrInvalid;
            return MACChallengeState.ExpiredOrInvalid;
        }

        return ch.State;
    }

    public string? GetActiveDenyMessage(string raw)
    {
        var normalized = NormalizeUsername(raw);
        if (!_pending.TryGetValue(normalized, out var ch) || ch.ExpiresAt <= DateTimeOffset.UtcNow)
            return null;

        return FormatDenyMessage(ch.OriginalUsername, ch.UserCode, ch.LoginUrl, ch.ExpiresAt);
    }

    public async Task<string?> StartChallengeAndGetDenyMessageAsync(string raw)
    {
        var normalized = NormalizeUsername(raw);
        var display = StripGuestPrefix(raw);

        _pending.Remove(normalized);
        _verified.Remove(normalized);

        var apiUrl = _cfg.GetCVar(MACCCVars.MACApiUrl).TrimEnd('/');
        var apiKey = _cfg.GetCVar(MACCCVars.MACApiKey);
        var environment = _cfg.GetCVar(MACCCVars.MACEnvironment);
        var providers = _cfg.GetCVar(MACCCVars.MACPolicyAllowedProviders)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        var body = new StartRequest(display, environment, new StartRequest.PolicyBlock(
            _cfg.GetCVar(MACCCVars.MACPolicyAllowNewAccounts),
            _cfg.GetCVar(MACCCVars.MACPolicyAllowGeneratedFallback),
            _cfg.GetCVar(MACCCVars.MACPolicyAllowUnofficialOAuth),
            providers,
            _cfg.GetCVar(MACCCVars.MACPolicyRequireExistingSs14Identity),
            _cfg.GetCVar(MACCCVars.MACPolicyRequireIdentitySelection),
            _cfg.GetCVar(MACCCVars.MACPolicyAllowAccountMerging)));

        try
        {
            var req = new HttpRequestMessage(HttpMethod.Post, $"{apiUrl}/api/auth-challenge/start");
            req.Headers.Add("x-api-key", apiKey);
            req.Content = JsonContent.Create(body);

            var resp = await _http.SendAsync(req);
            if (!resp.IsSuccessStatusCode)
            {
                Log.Error($"MAC /start returned {(int)resp.StatusCode} for '{display}'");
                return null;
            }

            var result = await resp.Content.ReadFromJsonAsync<StartResponse>();
            if (result?.Success != true || string.IsNullOrEmpty(result.UserCode))
            {
                Log.Error($"MAC /start returned bad body for '{display}'");
                return null;
            }

            var now = DateTimeOffset.UtcNow;
            var expiresAt = result.ExpiresAt ?? now.AddSeconds(_cfg.GetCVar(MACCCVars.MACChallengeTimeout));

            var ch = new PendingChallenge
            {
                OriginalUsername = display,
                NormalizedUsername = normalized,
                UserCode = result.UserCode,
                LoginUrl = result.LoginUrl,
                CheckToken = result.CheckToken,
                ExpiresAt = expiresAt,
                State = MACChallengeState.ChallengePending,
            };
            _pending[normalized] = ch;

            Log.Info($"MAC: started challenge for '{display}' code={result.UserCode} expires={expiresAt:O}");
            return FormatDenyMessage(display, ch.UserCode, ch.LoginUrl, ch.ExpiresAt);
        }
        catch (Exception ex)
        {
            Log.Error($"MAC /start threw for '{display}': {ex.Message}");
            return null;
        }
    }

    public async Task<NetUserId?> TryConsumePendingChallengeAsync(string raw)
    {
        if (!_cfg.GetCVar(MACCCVars.MACEnabled) || !IsGuestUsername(raw))
            return null;

        var normalized = NormalizeUsername(raw);
        var display = StripGuestPrefix(raw);
        var now = DateTimeOffset.UtcNow;

        if (_verified.TryGetValue(normalized, out var vm) && vm.ExpiresAt > now)
        {
            Log.Debug($"MAC: reusing verified session for '{display}' → {vm.EffectiveGuid}");
            return new NetUserId(vm.EffectiveGuid);
        }

        if (!_pending.TryGetValue(normalized, out var ch))
            return null;

        if (ch.ExpiresAt <= now)
        {
            ch.State = MACChallengeState.ExpiredOrInvalid;
            return null;
        }

        ch.LastConsumeAttemptAt = now;

        var apiUrl = _cfg.GetCVar(MACCCVars.MACApiUrl).TrimEnd('/');
        var apiKey = _cfg.GetCVar(MACCCVars.MACApiKey);
        var connId = $"ss14-{normalized}-{now.ToUnixTimeSeconds()}";

        try
        {
            var req = new HttpRequestMessage(HttpMethod.Post, $"{apiUrl}/api/auth-challenge/consume");
            req.Headers.Add("x-api-key", apiKey);
            req.Content = JsonContent.Create(new ConsumeRequest(ch.CheckToken, ch.OriginalUsername, connId));

            var resp = await _http.SendAsync(req);
            var status = (int)resp.StatusCode;

            if (resp.IsSuccessStatusCode)
            {
                var result = await resp.Content.ReadFromJsonAsync<ConsumeResponse>();
                if (result?.Success == true && result.Identity != null)
                {
                    var effectiveGuid = result.Identity.EffectiveGuid;

                    _verified[normalized] = new VerifiedMapping
                    {
                        EffectiveGuid = effectiveGuid,
                        CanonicalGuid = result.Identity.CanonicalGuid,
                        BindingType = result.Binding?.Type ?? string.Empty,
                        VerifiedAt = now,
                        ExpiresAt = now.AddSeconds(_cfg.GetCVar(MACCCVars.MACVerifiedSessionTimeout)),
                    };
                    ch.State = MACChallengeState.JustConsumed;

                    Log.Info($"MAC: consumed for '{display}' effectiveGuid={effectiveGuid} binding={result.Binding?.Type} type={result.Identity.IdentityType}");
                    return new NetUserId(effectiveGuid);
                }

                Log.Error($"MAC /consume returned 200 with bad body for '{display}'");
                ch.State = MACChallengeState.ApiError;
                return null;
            }

            switch (status)
            {
                case 409:
                    ch.State = MACChallengeState.PendingNotReady;
                    Log.Debug($"MAC: challenge not ready (409) for '{display}'");
                    return null;

                case 404:
                case 410:
                    Log.Info($"MAC: challenge {status} for '{display}', clearing");
                    _pending.Remove(normalized);
                    return null;

                case 400:
                    ch.State = MACChallengeState.ExpiredOrInvalid;
                    Log.Warning($"MAC: username mismatch (400) for '{display}' — reconnect with the same username");
                    return null;

                case 401:
                case 403:
                    ch.State = MACChallengeState.ApiError;
                    Log.Error($"MAC: API auth error ({status}) — check mac.api_key");
                    return null;

                default:
                    ch.State = MACChallengeState.ApiError;
                    Log.Error($"MAC /consume returned unexpected {status} for '{display}'");
                    return null;
            }
        }
        catch (Exception ex)
        {
            ch.State = MACChallengeState.ApiError;
            Log.Error($"MAC /consume threw for '{display}': {ex.Message}");
            return null;
        }
    }

    // Strips guest@/localhost@ while keeping the original casing — used for API calls and display.
    private static string StripGuestPrefix(string raw)
    {
        if (raw.StartsWith("guest@", StringComparison.OrdinalIgnoreCase))
            return raw["guest@".Length..];
        if (raw.StartsWith("localhost@", StringComparison.OrdinalIgnoreCase))
            return raw["localhost@".Length..];
        return raw;
    }

    private string FormatDenyMessage(string display, string code, string url, DateTimeOffset expiresAt)
    {
        var remaining = expiresAt - DateTimeOffset.UtcNow;
        var expires = remaining.TotalSeconds <= 0 ? "expired"
            : remaining.TotalSeconds < 60 ? $"{(int)remaining.TotalSeconds}s"
            : $"{(int)remaining.TotalMinutes}m {remaining.Seconds}s";

        return _cfg.GetCVar(MACCCVars.MACDenyMessageFormat)
            .Replace("{url}", url)
            .Replace("{code}", code)
            .Replace("{username}", display)
            .Replace("{expires}", expires);
    }

    private sealed class PendingChallenge
    {
        public required string OriginalUsername { get; init; }
        public required string NormalizedUsername { get; init; }
        public required string UserCode { get; init; }
        public required string LoginUrl { get; init; }
        public required string CheckToken { get; init; }
        public required DateTimeOffset ExpiresAt { get; init; }
        public MACChallengeState State { get; set; } = MACChallengeState.ChallengePending;
        public DateTimeOffset? LastConsumeAttemptAt { get; set; }
    }

    private sealed class VerifiedMapping
    {
        public required Guid EffectiveGuid { get; init; }
        public required Guid CanonicalGuid { get; init; } // debug/admin context only
        public required string BindingType { get; init; }
        public required DateTimeOffset VerifiedAt { get; init; }
        public required DateTimeOffset ExpiresAt { get; init; }
    }

    private sealed record StartRequest(
        [property: JsonPropertyName("username")] string Username,
        [property: JsonPropertyName("environment")] string Environment,
        [property: JsonPropertyName("policy")] StartRequest.PolicyBlock Policy)
    {
        public sealed record PolicyBlock(
            [property: JsonPropertyName("allowNewAccounts")] bool AllowNewAccounts,
            [property: JsonPropertyName("allowGeneratedFallbackIdentity")] bool AllowGeneratedFallbackIdentity,
            [property: JsonPropertyName("allowUnofficialOAuthProviders")] bool AllowUnofficialOAuthProviders,
            [property: JsonPropertyName("allowedProviders")] string[] AllowedProviders,
            [property: JsonPropertyName("requireExistingSs14Identity")] bool RequireExistingSs14Identity,
            [property: JsonPropertyName("requireIdentitySelection")] string RequireIdentitySelection,
            [property: JsonPropertyName("allowAccountMerging")] bool AllowAccountMerging);
    }

    private sealed record StartResponse(
        [property: JsonPropertyName("success")] bool Success,
        [property: JsonPropertyName("userCode")] string UserCode,
        [property: JsonPropertyName("checkToken")] string CheckToken,
        [property: JsonPropertyName("loginUrl")] string LoginUrl,
        [property: JsonPropertyName("expiresAt")] DateTimeOffset? ExpiresAt,
        [property: JsonPropertyName("environment")] string? Environment);

    private sealed record ConsumeRequest(
        [property: JsonPropertyName("checkToken")] string CheckToken,
        [property: JsonPropertyName("username")] string Username,
        [property: JsonPropertyName("connectionId")] string? ConnectionId);

    private sealed record ConsumeResponse(
        [property: JsonPropertyName("success")] bool Success,
        [property: JsonPropertyName("status")] string Status,
        [property: JsonPropertyName("identity")] ConsumeResponse.IdentityBlock? Identity,
        [property: JsonPropertyName("binding")] ConsumeResponse.BindingBlock? Binding)
    {
        public sealed record IdentityBlock(
            [property: JsonPropertyName("effectiveGuid")] Guid EffectiveGuid,
            [property: JsonPropertyName("canonicalGuid")] Guid CanonicalGuid,
            [property: JsonPropertyName("identityId")] string IdentityId,
            [property: JsonPropertyName("accountId")] string AccountId,
            [property: JsonPropertyName("username")] string Username,
            [property: JsonPropertyName("displayName")] string DisplayName,
            [property: JsonPropertyName("identityType")] string IdentityType,
            [property: JsonPropertyName("authority")] string Authority,
            [property: JsonPropertyName("fallbackVerified")] bool FallbackVerified);

        public sealed record BindingBlock(
            [property: JsonPropertyName("type")] string Type,
            [property: JsonPropertyName("serverOverrideApplied")] bool ServerOverrideApplied,
            [property: JsonPropertyName("serverOverrideId")] string? ServerOverrideId);
    }
}
