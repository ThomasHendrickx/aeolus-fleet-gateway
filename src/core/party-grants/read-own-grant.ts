import type { Actor } from '../actors/authenticate-actor.js';
import type { PartyStore } from '../parties/ports.js';
import { ok, type Result } from '../shared/result.js';
import type { OutsideAccount } from './party-grant.js';
import type { PartyGrants } from './ports.js';
import { signInPartyOf, type SignInPartyRefusal } from './sign-in-party.js';

/** A person's own sign-in to a party, as their page shows it: never a token. */
export type OwnGrant = { readonly state: 'notSignedIn' } | { readonly state: 'signedIn'; readonly outsideAccount: OutsideAccount; readonly signedInAt: Date; readonly lastUsedAt: Date | null };

export type ReadOwnGrant = (input: { actor: Actor; name: string }) => Promise<Result<OwnGrant, SignInPartyRefusal>>;

/** Use case: a person reads their own sign-in to an outside MCP server where each person signs in (decision 0067, Q12): the outside account it names, when they signed in, and when it was last used. */
export function createReadOwnGrant(deps: { parties: Pick<PartyStore, 'find'>; grants: Pick<PartyGrants, 'ofPerson'> }): ReadOwnGrant {
  return async (input) => {
    const signingIn = await signInPartyOf(deps.parties, input);
    if (!signingIn.isOk) {
      return signingIn;
    }
    const { party, personShipId } = signingIn.value;
    const grant = await deps.grants.ofPerson(party.fleetId, { party: party.name, personShipId });
    return ok(grant === undefined ? { state: 'notSignedIn' } : { state: 'signedIn', outsideAccount: grant.outsideAccount, signedInAt: grant.signedInAt, lastUsedAt: grant.lastUsedAt });
  };
}
