import type { FleetShips } from '../../core/parties/ports.js';
import { ok } from '../../core/shared/result.js';
import { everyListedShip } from './every-listed-ship.js';

/**
 * The fleet's ships as the actor reads them (fleet.list, decision 0057):
 * those within its read reach, as only they carry their kind, every page.
 */
export function createFleetShips(fleetUrl: string): FleetShips {
  return {
    list: async (as) => {
      const listed = await everyListedShip(fleetUrl, { as, filter: {} });
      return listed.isOk ? ok(listed.value.map(({ id, name, kind, status }) => ({ shipId: id, name, kind, status }))) : listed;
    },
  };
}
