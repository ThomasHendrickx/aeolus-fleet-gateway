import type { Actor } from '../actors/authenticate-actor.js';
import { ok, type Result } from '../shared/result.js';
import type { OutsideAccount } from './party-grant.js';
import type { PartyGrants, SignInServers } from './ports.js';
import { signInPartyOf, type SignInPartyRefusal } from './sign-in-party.js';

/** A person's own sign-in to a party, as their page shows it: never a token. */
export type OwnGrant = { readonly state: 'notSignedIn' } | { readonly state: 'signedIn'; readonly outsideAccount: OutsideAccount; readonly signedInAt: Date; readonly lastUsedAt: Date | null };

export type ReadOwnGrant = (input: { actor: Actor; name: string }) => Promise<Result<OwnGrant, SignInPartyRefusal>>;

/** Use case: a person reads their own sign-in to an outside MCP server where each person signs in (decision 0067, Q12): the outside account it names, when they signed in, and when it was last used. */
export function createReadOwnGrant(deps: { servers: SignInServers; grants: Pick<PartyGrants, 'ofPerson'> }): ReadOwnGrant {
  return async (input) => {
    const signingIn = await signInPartyOf(deps.servers, input);
    if (!signingIn.isOk) {
      return signingIn;
    }
    const { server, personShipId } = signingIn.value;
    const grant = await deps.grants.ofPerson(server.fleetId, { party: server.name, personShipId });
    return ok(grant === undefined ? { state: 'notSignedIn' } : { state: 'signedIn', outsideAccount: grant.outsideAccount, signedInAt: grant.signedInAt, lastUsedAt: grant.lastUsedAt });
  };
}
