import { fleetListOutputSchema } from '@aeolus-fleet/common';
import { PAGE_SIZE_MAX } from '@aeolus-fleet/common/rules';

import type { FleetShip, FleetShips } from '../../core/parties/ports.js';
import { err, ok } from '../../core/shared/result.js';
import { readAs } from './actor-door.js';

/**
 * The fleet's ships as the actor reads them (fleet.list, decision 0057):
 * those within its read reach, as only they carry their kind. The fleet
 * answers a page at a time (performance S6), so the list reads on from each
 * page's next cursor until it is null.
 */
export function createFleetShips(fleetUrl: string): FleetShips {
  return {
    list: async (as) => {
      const ships: FleetShip[] = [];
      let cursor: string | undefined;
      do {
        const read = await readAs(fleetUrl, { as, procedure: 'list', input: { ...(cursor === undefined ? {} : { cursor }), limit: PAGE_SIZE_MAX } });
        if (!read.isOk) {
          return read;
        }
        const page = fleetListOutputSchema.safeParse(read.value);
        if (!page.success) {
          return err({ code: 'UNAVAILABLE', message: 'The fleet answered no ships' });
        }
        ships.push(...page.data.items.flatMap((ship) => ('isInReadReach' in ship ? [] : [{ shipId: ship.id, name: ship.name, kind: ship.kind, status: ship.status }])));
        cursor = page.data.nextCursor ?? undefined;
      } while (cursor !== undefined);
      return ok(ships);
    },
  };
}
