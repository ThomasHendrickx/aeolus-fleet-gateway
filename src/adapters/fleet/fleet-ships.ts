import { fleetListOutputSchema } from '@aeolus-fleet/common';

import type { FleetShips } from '../../core/parties/ports.js';
import { err, ok } from '../../core/shared/result.js';
import { readAs } from './actor-door.js';

/**
 * The fleet's ships as the actor reads them (fleet.list, decision 0057):
 * those within its read reach, as only they carry their kind.
 */
export function createFleetShips(fleetUrl: string): FleetShips {
  return {
    list: async (as) => {
      const read = await readAs(fleetUrl, { as, procedure: 'list', input: {} });
      if (!read.isOk) {
        return read;
      }
      const ships = fleetListOutputSchema.safeParse(read.value);
      if (!ships.success) {
        return err({ code: 'UNAVAILABLE', message: 'The fleet answered no ships' });
      }
      return ok(ships.data.flatMap((ship) => ('isInReadReach' in ship ? [] : [{ shipId: ship.id, name: ship.name, kind: ship.kind, status: ship.status }])));
    },
  };
}
