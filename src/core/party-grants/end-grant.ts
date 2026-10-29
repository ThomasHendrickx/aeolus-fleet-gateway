import type { SignInClient } from '../vault/credential.js';
import type { PartyGrant } from './party-grant.js';
import type { PartyGrants, PartySignIns } from './ports.js';

/**
 * Ends a person's grant of a party (decision 0067, Q6): where the
 * authorization server offers revocation (RFC 7009), the refresh token is
 * revoked, then the access token; the grant is dropped either way, so the
 * person's ships call under it no more. Answers whether the server revoked
 * its tokens: false where it offers no revocation or did not answer.
 */
export async function endGrant(deps: { grants: Pick<PartyGrants, 'remove'>; signIns: Pick<PartySignIns, 'revoke'> }, ending: { client: SignInClient; grant: PartyGrant }): Promise<boolean> {
  const { client, grant } = ending;
  let isRevoked = false;
  const { revocationEndpoint } = client;
  if (revocationEndpoint !== null) {
    const tokens = grant.refreshToken === null ? [grant.accessToken] : [grant.refreshToken, grant.accessToken];
    const revoked = [];
    for (const token of tokens) {
      revoked.push(await deps.signIns.revoke({ ...client, revocationEndpoint }, token));
    }
    isRevoked = revoked.every((each) => each.isOk);
  }
  await deps.grants.remove(grant.fleetId, { party: grant.party, personShipId: grant.personShipId });
  return isRevoked;
}
