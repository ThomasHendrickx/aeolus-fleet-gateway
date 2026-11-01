import { ok, type Result } from '../shared/result.js';
import type { BasketEntries } from './basket.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { personCrewOf, type PersonCaller, type PersonCrewError } from './person-crew.js';

export type CountBasket = (caller: PersonCaller) => Promise<Result<{ count: number }, PersonCrewError>>;

/**
 * Use case: how many answers the person's basket holds, for Bridge's
 * navigation on every page (section 9, rule 2): counted in the gateway's
 * database, nothing read from the fleet.
 */
export function createCountBasket(deps: { crewPersonShip: CrewPersonShip; entries: BasketEntries }): CountBasket {
  return async (caller) => {
    const crew = await personCrewOf(deps.crewPersonShip, caller);
    return crew.isOk ? ok({ count: await deps.entries.count(caller.fleetId, crew.value.shipId) }) : crew;
  };
}
