import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { SignInClient } from '../vault/credential.js';
import { accessTokenEndsAtOf, type PartyGrant } from './party-grant.js';
import type { PartyGrants, PartySignIns, TokenRequestFailure } from './ports.js';

/**
 * Why a grant was not refreshed: it holds no refresh token; the
 * authorization server refused or did not answer the refresh; or the
 * person holds no grant of the party any more.
 */
export type RefreshFailure = { readonly kind: 'noRefreshToken' } | TokenRequestFailure | { readonly kind: 'removed' };

export type RefreshGrant = (input: { client: SignInClient; grant: PartyGrant }) => Promise<Result<PartyGrant, RefreshFailure>>;

/**
 * Use case: a person's grant is refreshed with its party's client (decision
 * 0067, Q7), one refresh at a time per grant: the grant is held while its
 * refresh runs, and the new tokens are kept before they are used (L19). A
 * grant whose access token is no longer the one asked for was refreshed, or
 * signed in again, meanwhile: it is answered as held, refreshing nothing, so
 * a rotated refresh token is never used twice. A server that issues no new
 * refresh token leaves the one held.
 */
export function createRefreshGrant(deps: { signIns: Pick<PartySignIns, 'refresh'>; grants: Pick<PartyGrants, 'change'>; clock: Clock }): RefreshGrant {
  return async ({ client, grant }) => {
    let failure: RefreshFailure | undefined;
    const refreshed = async (held: PartyGrant): Promise<PartyGrant> => {
      if (held.accessToken !== grant.accessToken) {
        return held;
      }
      if (held.refreshToken === null) {
        failure = { kind: 'noRefreshToken' };
        return held;
      }
      const answered = await deps.signIns.refresh(client, held.refreshToken);
      if (!answered.isOk) {
        failure = answered.error;
        return held;
      }
      const { accessToken, refreshToken, expiresInSeconds } = answered.value;
      return { ...held, accessToken, refreshToken: refreshToken ?? held.refreshToken, accessTokenEndsAt: accessTokenEndsAtOf(deps.clock.now(), expiresInSeconds) };
    };
    const kept = await deps.grants.change(grant, refreshed);
    if (kept === undefined) {
      return err({ kind: 'removed' });
    }
    return failure === undefined ? ok(kept) : err(failure);
  };
}
