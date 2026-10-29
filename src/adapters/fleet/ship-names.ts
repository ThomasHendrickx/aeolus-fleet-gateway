import { fleetListOutputSchema, type fleetListInputSchema } from '@aeolus-fleet/common';
import type { z } from 'zod';

import type { ShipNames } from '../../core/party-grants/ports.js';
import { err, ok } from '../../core/shared/result.js';
import { readAs } from './actor-door.js';

/**
 * The fleet's ship names as the actor reads them (fleet.list, decision 0057),
 * for a page of ships in one call: fleet.list filtered to their ids. A ship
 * outside the actor's read reach still answers its name (decision 0034).
 */
export function createShipNames(fleetUrl: string): ShipNames {
  return {
    namesOf: async (as, shipIds) => {
      const input: z.input<typeof fleetListInputSchema> = { shipIds: [...shipIds], limit: shipIds.length };
      const read = await readAs(fleetUrl, { as, procedure: 'list', input });
      if (!read.isOk) {
        return read;
      }
      const page = fleetListOutputSchema.safeParse(read.value);
      if (!page.success) {
        return err({ code: 'UNAVAILABLE', message: 'The fleet answered no ships' });
      }
      return ok(new Map(page.data.items.map((ship) => [ship.id, ship.name])));
    },
  };
}
