import type { ShipId } from '@aeolus-fleet/common';

import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { personCrewOf, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { QuietShip, QuietShips } from './quiet-ships.js';

/** How many quiet ships a page holds, as preferences show them. */
export const QUIET_SHIPS_PAGE_SIZE = 20;

/** A quiet ship as a person's client shows it: its name when quieted, and since when. */
export interface QuietShipView {
  readonly shipId: ShipId;
  readonly name: string;
  readonly since: Date;
}

export function quietShipViewOf({ quietShipId, name, changedAt }: QuietShip): QuietShipView {
  return { shipId: quietShipId, name, since: changedAt };
}

export type ReadQuietShips = (read: { caller: PersonCaller; cursor: ShipId | null }) => Promise<Result<{ ships: QuietShipView[]; nextCursor: ShipId | null }, PersonCrewError>>;

/** Use case: a person's client lists their quiet ships (preferences design), 20 at a time, the latest quieted first, after the cursor the last page answered. */
export function createReadQuietShips(deps: { crewPersonShip: CrewPersonShip; quietShips: Pick<QuietShips, 'listQuiet'> }): ReadQuietShips {
  return async ({ caller, cursor }) => {
    const crew = await personCrewOf(deps.crewPersonShip, caller);
    if (!crew.isOk) {
      return crew;
    }
    const page = await deps.quietShips.listQuiet({ fleetId: caller.fleetId, shipId: crew.value.shipId }, { cursor, limit: QUIET_SHIPS_PAGE_SIZE });
    return ok({ ships: page.ships.map(quietShipViewOf), nextCursor: page.nextCursor });
  };
}
