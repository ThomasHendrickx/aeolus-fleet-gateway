import type { Discovery } from '../mcp-in/ports.js';
import type { PartyStore } from '../parties/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { A2aCaller } from './authenticate-a2a-client.js';
import type { ListReachedShips, ListReachedShipsRefusal, ReachedShip } from './list-reached-ships.js';

export type FindReachedShipRefusal = ListReachedShipsRefusal | DomainError<'UNKNOWN_ALIAS'>;

export type FindReachedShip = (call: A2aCaller & { alias: string }) => Promise<Result<ReachedShip, FindReachedShipRefusal>>;

/**
 * Use case: the ship an A2A call's alias names (decision 0060). The alias
 * is derived, never looked up: the gateway computes the alias of each ship
 * the client reaches now and takes the one that matches. An alias of no
 * ship and one of a ship the client cannot reach get the same refusal, so
 * the client learns nothing about ships it cannot reach.
 */
export function createFindReachedShip(deps: { listReachedShips: ListReachedShips; parties: Pick<PartyStore, 'find'>; discovery: Discovery }): FindReachedShip {
  return async ({ alias, ...caller }) => {
    const reached = await deps.listReachedShips(caller);
    if (!reached.isOk) {
      return reached;
    }
    const ship = reached.value.find((each) => each.alias === alias);
    if (ship === undefined) return refuse('UNKNOWN_ALIAS', 'No such agent');
    const party = await deps.parties.find(caller.fleetId, caller.party);
    if (party?.state !== 'crewed' || party.crewToken === null) {
      return refuse('PARTY_NOT_CREWED', `The party ${caller.party} is not crewed`);
    }
    const detail = await deps.discovery.lookup(party.crewToken, ship.shipId);
    if (!detail.isOk) return refuse('FLEET_UNAVAILABLE', `The fleet did not answer the ship's statement: ${detail.error.message}`);
    return detail.value === null ? refuse('UNKNOWN_ALIAS', 'No such agent') : ok({ ...ship, statement: detail.value.statement });
  };
}
