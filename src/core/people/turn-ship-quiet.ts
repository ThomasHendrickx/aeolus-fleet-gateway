import type { ShipId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { personCrewOf, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { QuietShips } from './quiet-ships.js';

export type TurnShipQuiet = (turn: { caller: PersonCaller; shipId: ShipId; name: string; isQuiet: boolean }) => Promise<Result<undefined, PersonCrewError>>;

/**
 * Use case: a person quiets a ship, so it never wakes them, or wakes it
 * again (preferences design), kept by fleet, person ship and ship with when.
 * It applies at once, as every wake reads it anew. A ship already as asked
 * is kept as it is, so a quiet ship keeps since when it was quieted; a ship
 * never quieted needs nothing kept to wake the person.
 */
export function createTurnShipQuiet(deps: { crewPersonShip: CrewPersonShip; quietShips: Pick<QuietShips, 'among' | 'save'>; clock: Clock }): TurnShipQuiet {
  return async ({ caller, shipId, name, isQuiet }) => {
    const crew = await personCrewOf(deps.crewPersonShip, caller);
    if (!crew.isOk) {
      return crew;
    }
    const ship = { fleetId: caller.fleetId, shipId: crew.value.shipId };
    const [chosen] = await deps.quietShips.among(ship, [shipId]);
    if ((chosen?.isQuiet ?? false) === isQuiet) {
      return ok(undefined);
    }
    await deps.quietShips.save({ ...ship, quietShipId: shipId, name, isQuiet, changedAt: deps.clock.now() });
    return ok(undefined);
  };
}
