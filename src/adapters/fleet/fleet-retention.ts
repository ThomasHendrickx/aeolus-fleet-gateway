import { fleetLimitsOutputSchema } from '@aeolus-fleet/common';

import type { FleetRetention } from '../../core/people/ports.js';
import { err, ok } from '../../core/shared/result.js';
import { readAs } from './actor-door.js';

/** Of fleet.limits the gateway keeps the retention alone. */
const retentionSchema = fleetLimitsOutputSchema.pick({ retention: true });

/**
 * The fleet's retention as the actor reads it, from core's fleet.limits
 * (fleet:read): the days it keeps its finished history and from when messages
 * are kept, each null for none. Core answers it from the fleet's own row, so
 * the read costs the same in a fleet of any size. Limits has no REST door for
 * a read, so it goes over tRPC with the headers a REST call carries.
 */
export function createFleetRetention(fleetUrl: string): FleetRetention {
  return {
    retention: async (as) => {
      const read = await readAs(fleetUrl, { as, procedure: 'limits', input: null, isTrpcOnly: true });
      if (!read.isOk) {
        return read;
      }
      const limits = retentionSchema.safeParse(read.value);
      return limits.success ? ok(limits.data.retention) : err({ code: 'UNAVAILABLE', message: 'The fleet answered no retention' });
    },
  };
}
