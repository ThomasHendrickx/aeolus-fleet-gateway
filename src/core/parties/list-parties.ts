import type { FleetId } from '@aeolus-fleet/common';

import type { ConnectionStore } from '../connection/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { Party } from './party.js';
import { shownPartyOf, type FromFleet, type ListedParty } from './shown-party.js';
import type { PartyStore, ProxyShipReads } from './ports.js';

export type ListParties = (fleetId: FleetId) => Promise<ListedParty[]>;

export type ReadParty = (party: { fleetId: FleetId; name: string }) => Promise<Result<ListedParty, DomainError<'NO_SUCH_PARTY'>>>;

interface ReadDeps {
  parties: PartyStore;
  connections: Pick<ConnectionStore, 'find'>;
  fleet: ProxyShipReads;
}

const UNKNOWN: FromFleet = { ownerShipId: null, scopes: null };

/** The party with what the fleet holds for its proxy ship, read as the gateway's ship; unknown while it cannot be read. */
async function listed(deps: ReadDeps, party: Party): Promise<ListedParty> {
  const gateway = await deps.connections.find(party.fleetId);
  if (party.proxyShipId === null || gateway === undefined) {
    return { ...shownPartyOf(party), ...UNKNOWN };
  }
  const read = await deps.fleet.read(gateway.crewToken, { shipId: party.proxyShipId });
  return { ...shownPartyOf(party), ...(read.isOk ? read.value : UNKNOWN) };
}

/**
 * Use case: the fleet's outside parties, by name: never a credential or a
 * crew token. Each proxy ship's owner and scopes are the fleet's alone
 * (decision 0056), read as the gateway's ship.
 */
export function createListParties(deps: ReadDeps): ListParties {
  return async (fleetId) => {
    const parties = (await deps.parties.list(fleetId)).sort((left, right) => left.name.localeCompare(right.name));
    return Promise.all(parties.map((party) => listed(deps, party)));
  };
}

/** Use case: one outside party by name, as the list shows it. */
export function createReadParty(deps: ReadDeps): ReadParty {
  return async ({ fleetId, name }) => {
    const party = await deps.parties.find(fleetId, name);
    return party === undefined ? refuse('NO_SUCH_PARTY', `There is no outside party ${name}`) : ok(await listed(deps, party));
  };
}
