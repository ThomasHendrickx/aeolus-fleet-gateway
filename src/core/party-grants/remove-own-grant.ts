import type { Actor } from '../actors/authenticate-actor.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { endGrant } from './end-grant.js';
import type { PartyGrants, PartySignIns, SignInServers } from './ports.js';
import { signInPartyOf, type SignInPartyRefusal } from './sign-in-party.js';

export type RemoveOwnGrant = (input: { actor: Actor; name: string }) => Promise<Result<{ /** Whether the authorization server revoked its tokens; false where it offers no revocation or did not answer. */ isRevoked: boolean }, SignInPartyRefusal | DomainError<'NOT_SIGNED_IN'>>>;

/** Use case: a person removes their own sign-in to an outside MCP server (decision 0067, Q6), ended as every grant ends. */
export function createRemoveOwnGrant(deps: { servers: SignInServers; grants: Pick<PartyGrants, 'ofPerson' | 'remove'>; signIns: Pick<PartySignIns, 'revoke'> }): RemoveOwnGrant {
  return async (input) => {
    const signingIn = await signInPartyOf(deps.servers, input);
    if (!signingIn.isOk) {
      return signingIn;
    }
    const { server, client, personShipId } = signingIn.value;
    const grant = await deps.grants.ofPerson(server.fleetId, { party: server.name, personShipId });
    if (grant === undefined) {
      return refuse('NOT_SIGNED_IN', `You are not signed in to ${server.name}`);
    }
    const isRevoked = await endGrant(deps, { client, grant });
    return ok({ isRevoked });
  };
}
