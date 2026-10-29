import type { ShipId } from '@aeolus-fleet/common';

import type { DiscoveredStatement, Discovery, ShipAliases } from '../mcp-in/ports.js';
import type { PartyStore } from '../parties/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { A2aCaller } from './authenticate-a2a-client.js';

/** A ship an A2A client may send to now, as it knows it: by its alias, with its statement; its id stays inside the gateway. */
export interface ReachedShip {
  shipId: ShipId;
  alias: string;
  statement: DiscoveredStatement;
}

export type ListReachedShipsRefusal = DomainError<'PARTY_NOT_CREWED' | 'FLEET_UNAVAILABLE'>;

export type ListReachedShips = (caller: A2aCaller) => Promise<Result<ReachedShip[], ListReachedShipsRefusal>>;

/**
 * Use case: the ships an A2A client reaches now (decision 0060), as the
 * fleet's discover answers its proxy ship: the gateway shows exactly what
 * core answers and adds no reach of its own. argo is left out: every ship
 * may send to argo, and argo is no card.
 */
export function createListReachedShips(deps: { parties: Pick<PartyStore, 'find'>; discovery: Discovery; aliases: ShipAliases }): ListReachedShips {
  return async ({ fleetId, party: name }) => {
    const party = await deps.parties.find(fleetId, name);
    if (party?.kind !== 'a2aClient' || party.state !== 'crewed' || party.crewToken === null) {
      return refuse('PARTY_NOT_CREWED', `The party ${name} is not crewed`);
    }
    const discovered = await deps.discovery.discover(party.crewToken);
    if (!discovered.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not answer which ships the party reaches: ${discovered.error.message}`);
    }
    return ok(discovered.value.filter((ship) => ship.kind !== 'operator').map((ship) => ({ shipId: ship.shipId, alias: deps.aliases.aliasOf(fleetId, ship.shipId), statement: ship.statement })));
  };
}
