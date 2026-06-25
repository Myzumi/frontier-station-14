using Robust.Shared.Configuration;

namespace Content.Shared._MAC.CCVar;

[CVarDefs]
public sealed class MACCCVars
{
    /*
     * Core
     */

    /// <summary>Enable MAC guest auth. Intended for use with auth.mode = 1 (Optional).</summary>
    public static readonly CVarDef<bool> MACEnabled =
        CVarDef.Create("mac.enabled", false, CVar.SERVERONLY);

    /// <summary>Base URL of the MAC API, e.g. "https://guest-auth.example.net".</summary>
    public static readonly CVarDef<string> MACApiUrl =
        CVarDef.Create("mac.api_url", string.Empty, CVar.SERVERONLY);

    /// <summary>API key sent as x-api-key on all MAC requests.</summary>
    public static readonly CVarDef<string> MACApiKey =
        CVarDef.Create("mac.api_key", string.Empty, CVar.CONFIDENTIAL | CVar.SERVERONLY);

    /// <summary>Environment tag forwarded to the API. "production" or "sandbox".</summary>
    public static readonly CVarDef<string> MACEnvironment =
        CVarDef.Create("mac.environment", "production", CVar.SERVERONLY);

    /*
     * Timeouts
     */

    /// <summary>Fallback code lifetime in seconds when the API does not return expiresAt.</summary>
    public static readonly CVarDef<int> MACChallengeTimeout =
        CVarDef.Create("mac.challenge_timeout", 300, CVar.SERVERONLY);

    /// <summary>Local grace window in seconds for reconnect-retry handling.</summary>
    public static readonly CVarDef<int> MACReconnectGraceTimeout =
        CVarDef.Create("mac.reconnect_grace_timeout", 90, CVar.SERVERONLY);

    /// <summary>How long in seconds a successful effectiveGuid is cached before re-consuming.</summary>
    public static readonly CVarDef<int> MACVerifiedSessionTimeout =
        CVarDef.Create("mac.verified_session_timeout", 600, CVar.SERVERONLY);

    /*
     * Messaging
     */

    /// <summary>Deny message shown to guests. Tokens: {url}, {code}, {username}, {expires}.</summary>
    public static readonly CVarDef<string> MACDenyMessageFormat =
        CVarDef.Create(
            "mac.deny_message_format",
            "Authentication required.\n\nVisit:\n{url}\n\nEnter code: {code}\n\nReconnect as: {username}\nExpires in: {expires}",
            CVar.SERVERONLY);

    /*
     * Policy — forwarded verbatim to /start.
     * The web service handles OAuth, linking, and identity selection.
     */

    /// <summary>Allow Steam/Discord-only users to create a broker account during this challenge.</summary>
    public static readonly CVarDef<bool> MACPolicyAllowNewAccounts =
        CVarDef.Create("mac.policy.allow_new_accounts", false, CVar.SERVERONLY);

    /// <summary>Allow the service to generate an in-house UUIDv8 identity if no SS14 GUID exists.</summary>
    public static readonly CVarDef<bool> MACPolicyAllowGeneratedFallback =
        CVarDef.Create("mac.policy.allow_generated_fallback", false, CVar.SERVERONLY);

    /// <summary>Show and accept community/unofficial OAuth providers.</summary>
    public static readonly CVarDef<bool> MACPolicyAllowUnofficialOAuth =
        CVarDef.Create("mac.policy.allow_unofficial_oauth", false, CVar.SERVERONLY);

    /// <summary>Comma-separated allowlist of identity providers sent to the API.</summary>
    public static readonly CVarDef<string> MACPolicyAllowedProviders =
        CVarDef.Create("mac.policy.allowed_providers", "ss14_legacy,ss14_new,steam,discord", CVar.SERVERONLY);

    /// <summary>Challenge completion must resolve to a verified SS14 identity.</summary>
    public static readonly CVarDef<bool> MACPolicyRequireExistingSs14Identity =
        CVarDef.Create("mac.policy.require_existing_ss14_identity", true, CVar.SERVERONLY);

    /// <summary>Force users with multiple personas to choose one. "auto", "always", or "never".</summary>
    public static readonly CVarDef<string> MACPolicyRequireIdentitySelection =
        CVarDef.Create("mac.policy.require_identity_selection", "auto", CVar.SERVERONLY);

    /// <summary>Allow the browser flow to merge/link providers into an existing account.</summary>
    public static readonly CVarDef<bool> MACPolicyAllowAccountMerging =
        CVarDef.Create("mac.policy.allow_account_merging", true, CVar.SERVERONLY);
}
