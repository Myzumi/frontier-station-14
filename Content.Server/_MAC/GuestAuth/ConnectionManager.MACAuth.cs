using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Content.Server._MAC.GuestAuth;
using Content.Server.Database;
using Content.Shared._MAC.CCVar;
using Robust.Shared.Network;

namespace Content.Server.Connection;

public sealed partial class ConnectionManager
{
    [Dependency] private readonly MACAuthManager _macAuth = default!;

    private async Task<NetUserId?> TryResolveMACUserIdAsync(string raw)
    {
        if (!_cfg.GetCVar(MACCCVars.MACEnabled) || !_macAuth.IsGuestUsername(raw))
            return null;

        return await _macAuth.TryConsumePendingChallengeAsync(raw);
    }

    // When MAC is active for a guest, skip the normal DB guest-name lookup entirely.
    private bool ShouldBypassGuestDbLookup(string raw)
    {
        return _cfg.GetCVar(MACCCVars.MACEnabled) && _macAuth.IsGuestUsername(raw);
    }

    private async Task<(ConnectionDenyReason, string, List<ServerBanDef>? bansHit)?> CheckMACGuestAuthAsync(
        NetConnectingArgs e)
    {
        if (!_cfg.GetCVar(MACCCVars.MACEnabled))
            return null;

        if (e.AuthType == LoginType.LoggedIn)
            return null;

        var raw = e.UserName;
        if (!_macAuth.IsGuestUsername(raw))
            return null;

        var normalized = _macAuth.NormalizeUsername(raw);
        var state = _macAuth.GetChallengeState(normalized);

        switch (state)
        {
            case MACChallengeState.JustConsumed:
            {
                if (_plyMgr.Sessions.Any(s => s.UserId == e.UserId))
                {
                    _sawmill.Warning($"MAC: {e.UserId} already online, denying '{raw}' to prevent duplicate session");
                    return (ConnectionDenyReason.Whitelist,
                        "This account is already connected to the server.\nIf this is unexpected, wait a moment and try again.",
                        null);
                }
                return null;
            }

            case MACChallengeState.PendingNotReady:
            {
                var msg = _macAuth.GetActiveDenyMessage(raw)
                    ?? "Finish the website authentication flow, then reconnect.";
                return (ConnectionDenyReason.Whitelist, msg, null);
            }

            case MACChallengeState.ApiError:
                return (ConnectionDenyReason.Whitelist,
                    "The authentication service is currently unavailable. Please try again later or contact an admin.",
                    null);

            case MACChallengeState.ChallengePending:
            {
                var msg = _macAuth.GetActiveDenyMessage(raw);
                if (msg != null)
                    return (ConnectionDenyReason.Whitelist, msg, null);
                goto case MACChallengeState.None;
            }

            case MACChallengeState.ExpiredOrInvalid:
            case MACChallengeState.None:
            default:
            {
                var msg = await _macAuth.StartChallengeAndGetDenyMessageAsync(raw);
                return (ConnectionDenyReason.Whitelist,
                    msg ?? "Failed to start authentication. Please contact a server administrator.",
                    null);
            }
        }
    }
}
