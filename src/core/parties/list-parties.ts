import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential, CredentialOf } from '../actors/credential-of.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { Party } from './party.js';
import { shownPartyOf, type FromFleet, type ListedParty } from './shown-party.js';
import type { PartyStore, ProxyShipReads } from './ports.js';

interface ReadCall {
  actor: Actor;
  as: ActorCredential;
}

export type ListParties = (call: ReadCall) => Promise<ListedParty[]>;

export type ReadParty = (call: ReadCall & { name: string }) => Promise<Result<ListedParty, DomainError<'NO_SUCH_PARTY'>>>;

interface ReadDeps {
  parties: PartyStore;
  fleet: ProxyShipReads;
  credentialOf: CredentialOf;
}

const UNKNOWN: FromFleet = { proxyShipName: null, ownerShipId: null, ownerName: null, scopes: null };

/** The parties with what the fleet holds for each proxy ship, read as the actor; unknown outside its read reach, or while it cannot be read. */
async function listed(deps: ReadDeps, call: ReadCall & { parties: Party[] }): Promise<ListedParty[]> {
  const credential = await deps.credentialOf(call.actor, call.as);
  return Promise.all(
    call.parties.map(async (party) => {
      if (party.proxyShipId === null || !credential.isOk) {
        return { ...shownPartyOf(party), ...UNKNOWN };
      }
      const read = await deps.fleet.read(credential.value, { shipId: party.proxyShipId });
      return { ...shownPartyOf(party), ...(read.isOk ? read.value : UNKNOWN) };
    }),
  );
}

/**
 * Use case: the actor's fleet's outside parties, by name: never a credential
 * or a crew token. Each proxy ship's owner and scopes are the fleet's alone
 * (decision 0056), read as the actor, so the fleet answers within its read
 * reach.
 */
export function createListParties(deps: ReadDeps): ListParties {
  return async ({ actor, as }) => {
    const parties = (await deps.parties.list(actor.fleetId)).sort((left, right) => left.name.localeCompare(right.name));
    return listed(deps, { actor, as, parties });
  };
}

/** Use case: one outside party by name, as the list shows it. */
export function createReadParty(deps: ReadDeps): ReadParty {
  return async ({ actor, as, name }) => {
    const party = await deps.parties.find(actor.fleetId, name);
    if (party === undefined) {
      return refuse('NO_SUCH_PARTY', `There is no outside party ${name}`);
    }
    const [shown] = await listed(deps, { actor, as, parties: [party] });
    return shown === undefined ? refuse('NO_SUCH_PARTY', `There is no outside party ${name}`) : ok(shown);
  };
}
