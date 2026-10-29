import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { SignInClient } from '../vault/credential.js';
import { accessTokenEndsAtOf, type GrantLost, type PartyGrant } from './party-grant.js';
import type { PartyGrants, PartySignIns, TokenRequestFailure } from './ports.js';
import type { TellSignInNeeded } from './tell-sign-in-needed.js';

/** The OAuth error a refresh token the authorization server will not refresh again is refused with (RFC 6749 5.2). */
const INVALID_GRANT = 'invalid_grant';

/**
 * Why a grant was not refreshed: it holds no refresh token; the
 * authorization server refused or did not answer the refresh; the grant is
 * lost, the server having answered `invalid_grant`; or the person holds no
 * grant of the party any more.
 */
export type RefreshFailure = { readonly kind: 'noRefreshToken' } | TokenRequestFailure | { readonly kind: 'lost'; readonly lost: GrantLost } | { readonly kind: 'removed' };

export type RefreshGrant = (input: { client: SignInClient; grant: PartyGrant }) => Promise<Result<PartyGrant, RefreshFailure>>;

/**
 * Use case: a person's grant is refreshed with its party's client (decision
 * 0067, Q7), one refresh at a time per grant: the grant is held while its
 * refresh runs, and the new tokens are kept before they are used (L19). A
 * grant whose access token is no longer the one asked for was refreshed, or
 * signed in again, meanwhile: it is answered as held, refreshing nothing, so
 * a rotated refresh token is never used twice. A server that issues no new
 * refresh token leaves the one held. A refresh answered `invalid_grant`
 * loses the grant, kept with when and why, and tells the person once (Q5,
 * Q6); any other refusal keeps it as it was.
 */
export function createRefreshGrant(deps: { signIns: Pick<PartySignIns, 'refresh'>; grants: Pick<PartyGrants, 'change'>; tellSignInNeeded: TellSignInNeeded; clock: Clock }): RefreshGrant {
  return async ({ client, grant }) => {
    let failure: RefreshFailure | undefined;
    const losing: { lost: GrantLost | null } = { lost: null };
    const refreshed = async (held: PartyGrant): Promise<PartyGrant> => {
      if (held.lost !== null) {
        failure = { kind: 'lost', lost: held.lost };
        return held;
      }
      if (held.accessToken !== grant.accessToken) {
        return held;
      }
      if (held.refreshToken === null) {
        failure = { kind: 'noRefreshToken' };
        return held;
      }
      const answered = await deps.signIns.refresh(client, held.refreshToken);
      if (!answered.isOk) {
        if (answered.error.kind === 'refused' && answered.error.error === INVALID_GRANT) {
          const lost = { at: deps.clock.now(), why: answered.error.reason };
          failure = { kind: 'lost', lost };
          losing.lost = lost;
          return { ...held, lost };
        }
        failure = answered.error;
        return held;
      }
      const { accessToken, refreshToken, expiresInSeconds } = answered.value;
      const now = deps.clock.now();
      return { ...held, accessToken, refreshToken: refreshToken ?? held.refreshToken, accessTokenEndsAt: accessTokenEndsAtOf(now, expiresInSeconds), refreshedAt: now };
    };
    const kept = await deps.grants.change(grant, refreshed);
    if (kept === undefined) {
      return err({ kind: 'removed' });
    }
    if (losing.lost !== null) {
      // Told once the loss is kept, never while the grant is held.
      await deps.tellSignInNeeded({ fleetId: kept.fleetId, party: kept.party, personShipId: kept.personShipId, lost: losing.lost });
    }
    return failure === undefined ? ok(kept) : err(failure);
  };
}
