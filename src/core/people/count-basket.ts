import { ok, type Result } from '../shared/result.js';
import { basketCountOf, standingOf, type BasketEntries } from './basket.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { personCrewOf, type PersonCaller, type PersonCrewError } from './person-crew.js';

export type CountBasket = (caller: PersonCaller) => Promise<Result<{ count: number }, PersonCrewError>>;

/**
 * Use case: how many answers the person's basket holds, for Bridge's
 * navigation on every page (section 9, rule 2): counted as the basket
 * counts, from the gateway's database, nothing read from the fleet, so an
 * entry withdrawn or replaced counts until Send or Remove takes it out.
 */
export function createCountBasket(deps: { crewPersonShip: CrewPersonShip; entries: BasketEntries }): CountBasket {
  return async (caller) => {
    const crew = await personCrewOf(deps.crewPersonShip, caller);
    if (!crew.isOk) {
      return crew;
    }
    const entries = await deps.entries.list(caller.fleetId, crew.value.shipId);
    return ok({ count: basketCountOf(entries.map((entry) => standingOf(entry, { outcome: undefined, stale: null }))) });
  };
}
