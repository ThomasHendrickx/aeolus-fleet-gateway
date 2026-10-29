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
export function createFindReachedShip(deps: { listReachedShips: ListReachedShips }): FindReachedShip {
  return async ({ alias, ...caller }) => {
    const reached = await deps.listReachedShips(caller);
    if (!reached.isOk) {
      return reached;
    }
    const ship = reached.value.find((each) => each.alias === alias);
    return ship === undefined ? refuse('UNKNOWN_ALIAS', 'No such agent') : ok(ship);
  };
}
