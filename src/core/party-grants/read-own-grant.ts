import type { Actor } from '../actors/authenticate-actor.js';
import { ok, type Result } from '../shared/result.js';
import type { GrantLost, OutsideAccount, PartyGrant } from './party-grant.js';
import type { PartyGrants, SignInServers } from './ports.js';
import { signInPartyOf, type SignInPartyRefusal } from './sign-in-party.js';

interface HeldGrant {
  readonly outsideAccount: OutsideAccount;
  readonly signedInAt: Date;
  readonly lastUsedAt: Date | null;
}

/** A person's own sign-in to a party, as their page shows it: never a token. A lost one says when and why (Q5). */
export type OwnGrant = { readonly state: 'notSignedIn' } | ({ readonly state: 'signedIn' } & HeldGrant) | ({ readonly state: 'lost'; readonly lost: GrantLost } & HeldGrant);

export type ReadOwnGrant = (input: { actor: Actor; name: string }) => Promise<Result<OwnGrant, SignInPartyRefusal>>;

/** Use case: a person reads their own sign-in to an outside MCP server where each person signs in (decision 0067, Q12): the outside account it names, when they signed in, when it was last used, and whether it was lost. */
export function createReadOwnGrant(deps: { servers: SignInServers; grants: Pick<PartyGrants, 'ofPerson'> }): ReadOwnGrant {
  return async (input) => {
    const signingIn = await signInPartyOf(deps.servers, input);
    if (!signingIn.isOk) {
      return signingIn;
    }
    const { server, personShipId } = signingIn.value;
    const grant = await deps.grants.ofPerson(server.fleetId, { party: server.name, personShipId });
    if (grant === undefined) {
      return ok({ state: 'notSignedIn' });
    }
    return ok(shownGrantOf(grant));
  };
}

/** A held grant as a page shows it: never a token. */
export function shownGrantOf(grant: PartyGrant): Exclude<OwnGrant, { state: 'notSignedIn' }> {
  const { outsideAccount, signedInAt, lastUsedAt, lost } = grant;
  return lost === null ? { state: 'signedIn', outsideAccount, signedInAt, lastUsedAt } : { state: 'lost', outsideAccount, signedInAt, lastUsedAt, lost };
}
