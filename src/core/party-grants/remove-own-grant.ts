import type { Actor } from '../actors/authenticate-actor.js';
import type { PartyStore } from '../parties/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { PartyGrants, PartySignIns } from './ports.js';
import { signInPartyOf, type SignInPartyRefusal } from './sign-in-party.js';

export type RemoveOwnGrant = (input: { actor: Actor; name: string }) => Promise<Result<{ /** Whether the authorization server revoked its tokens; false where it offers no revocation or did not answer. */ isRevoked: boolean }, SignInPartyRefusal | DomainError<'NOT_SIGNED_IN'>>>;

/**
 * Use case: a person removes their own sign-in to an outside MCP server
 * (decision 0067, Q6). Where the authorization server offers revocation
 * (RFC 7009), the refresh token is revoked, then the access token; the grant
 * is dropped either way, so the person's ships call under it no more.
 */
export function createRemoveOwnGrant(deps: { parties: Pick<PartyStore, 'find'>; grants: Pick<PartyGrants, 'ofPerson' | 'remove'>; signIns: Pick<PartySignIns, 'revoke'> }): RemoveOwnGrant {
  return async (input) => {
    const signingIn = await signInPartyOf(deps.parties, input);
    if (!signingIn.isOk) {
      return signingIn;
    }
    const { party, client, personShipId } = signingIn.value;
    const grant = await deps.grants.ofPerson(party.fleetId, { party: party.name, personShipId });
    if (grant === undefined) {
      return refuse('NOT_SIGNED_IN', `You are not signed in to ${party.name}`);
    }
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
    await deps.grants.remove(party.fleetId, { party: party.name, personShipId });
    return ok({ isRevoked });
  };
}
