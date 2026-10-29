import { shipOutputSchema } from '@aeolus-fleet/common';

import type { ProxyShipReads } from '../../core/parties/ports.js';
import { err, ok } from '../../core/shared/result.js';
import { readAs } from './actor-door.js';

/**
 * A party's proxy ship as the actor reads it (fleet.ship, decision 0057): its
 * name, owner and scopes within the actor's read reach, and only its name
 * outside it, where the fleet answers only the ship's name, type and status.
 */
export function createProxyShipReads(fleetUrl: string): ProxyShipReads {
  return {
    read: async (as, { shipId }) => {
      const read = await readAs(fleetUrl, { as, procedure: 'ship', input: { shipId } });
      if (!read.isOk) {
        return read;
      }
      const ship = shipOutputSchema.safeParse(read.value);
      if (!ship.success) {
        return err({ code: 'UNAVAILABLE', message: 'The fleet answered no ship' });
      }
      if ('isInReadReach' in ship.data) {
        return ok({ proxyShipName: ship.data.name, ownerShipId: null, ownerName: null, scopes: null });
      }
      return ok({ proxyShipName: ship.data.name, ownerShipId: ship.data.owner?.id ?? null, ownerName: ship.data.owner?.name ?? null, scopes: [...ship.data.scopes] });
    },
  };
}
