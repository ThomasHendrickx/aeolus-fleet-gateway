import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { SignInClient } from '../vault/credential.js';
import { accessTokenEndsAtOf, type PartyGrant } from './party-grant.js';
import type { PartyGrants, PartySignIns, TokenRequestFailure } from './ports.js';

/**
 * Why a grant was not refreshed: it holds no refresh token; the
 * authorization server refused or did not answer the refresh; or a new
 * sign-in replaced the grant, or it was removed, while it was refreshed.
 */
export type RefreshFailure = { readonly kind: 'noRefreshToken' } | TokenRequestFailure | { readonly kind: 'replaced' };

export type RefreshGrant = (input: { client: SignInClient; grant: PartyGrant }) => Promise<Result<PartyGrant, RefreshFailure>>;

/**
 * Use case: a person's grant is refreshed with its party's client (decision
 * 0067), as a call the server refused its access token needs, and the new
 * tokens are kept before they are used. A server that issues no new refresh
 * token leaves the one held. Tokens refreshed for a grant a new sign-in
 * replaced meanwhile are not kept over it.
 */
export function createRefreshGrant(deps: { signIns: Pick<PartySignIns, 'refresh'>; grants: Pick<PartyGrants, 'replaceTokens'>; clock: Clock }): RefreshGrant {
  return async ({ client, grant }) => {
    if (grant.refreshToken === null) {
      return err({ kind: 'noRefreshToken' });
    }
    const refreshed = await deps.signIns.refresh(client, grant.refreshToken);
    if (!refreshed.isOk) {
      return refreshed;
    }
    const { accessToken, refreshToken, expiresInSeconds } = refreshed.value;
    const tokens = { accessToken, refreshToken: refreshToken ?? grant.refreshToken, accessTokenEndsAt: accessTokenEndsAtOf(deps.clock.now(), expiresInSeconds) };
    const kept = await deps.grants.replaceTokens(grant, tokens);
    return kept === 'kept' ? ok({ ...grant, ...tokens }) : err({ kind: 'replaced' });
  };
}
