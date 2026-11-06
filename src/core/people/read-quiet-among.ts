import type { ShipId } from '@aeolus-fleet/common';

import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { personCrewOf, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { QuietShips } from './quiet-ships.js';
import { quietShipViewOf, type QuietShipView } from './read-quiet-ships.js';

export type ReadQuietAmong = (read: { caller: PersonCaller; shipIds: readonly ShipId[] }) => Promise<Result<QuietShipView[], PersonCrewError>>;

/** Use case: a person's client asks which of the ships it shows are quiet (preferences design), to mark them in a conversation and the list of conversations. */
export function createReadQuietAmong(deps: { crewPersonShip: CrewPersonShip; quietShips: Pick<QuietShips, 'among'> }): ReadQuietAmong {
  return async ({ caller, shipIds }) => {
    const crew = await personCrewOf(deps.crewPersonShip, caller);
    if (!crew.isOk) {
      return crew;
    }
    const chosen = await deps.quietShips.among({ fleetId: caller.fleetId, shipId: crew.value.shipId }, shipIds);
    return ok(chosen.filter(({ isQuiet }) => isQuiet).map(quietShipViewOf));
  };
}
