import type { ProxyShipsAsActor } from '../../core/parties/ports.js';
import { err, ok } from '../../core/shared/result.js';
import { mutateAs } from './actor-door.js';

/** A party's proxy ship, as the actor calls the fleet on it (decision 0057). */
export function createProxyShipsAsActor(fleetUrl: string): ProxyShipsAsActor {
  return {
    retire: async (as, { shipId }) => {
      const retired = await mutateAs(fleetUrl, { as, procedure: 'retire', input: { shipId } });
      return retired.isOk ? ok(undefined) : err(retired.error);
    },
  };
}
