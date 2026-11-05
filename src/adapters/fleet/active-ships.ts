import { harbourOutputSchema } from '@aeolus-fleet/common';
import { PAGE_SIZE_MAX } from '@aeolus-fleet/common/rules';
import { z } from 'zod';

import type { ListedShip, ShipState } from '../../core/people/your-fleet.js';
import type { ActiveShips } from '../../core/people/ports.js';
import { err, ok } from '../../core/shared/result.js';
import { readAs } from './actor-door.js';

/**
 * Bridge's state of each state core answers. Core 0.38.0 splits waiting into
 * awaiting crew and blocked (aeolus-fleet#1618), the two things waiting meant;
 * Bridge still shows both as waiting.
 */
const SHIP_STATE_OF: Readonly<Record<'alert' | 'waiting' | 'awaitingCrew' | 'blocked' | 'working' | 'idle', ShipState>> = {
  alert: 'alert',
  waiting: 'waiting',
  awaitingCrew: 'waiting',
  blocked: 'waiting',
  working: 'working',
  idle: 'idle',
};

const harbourStateSchema = z.enum(['alert', 'waiting', 'awaitingCrew', 'blocked', 'working', 'idle']).transform((state) => SHIP_STATE_OF[state]);

/**
 * A page of fleet.harbour as Bridge reads it: common's tile with the state of
 * either core, and no numbers, which the gateway counts itself.
 */
const harbourPageSchema = z.object({
  items: z.array(harbourOutputSchema.shape.items.element.extend({ state: harbourStateSchema })),
  nextCursor: harbourOutputSchema.shape.nextCursor,
});

/**
 * The fleet's active ships as the actor reads them, for Your fleet: core's
 * Harbour (fleet.harbour, docs/design/fleet-overview) answers each ship's
 * tile within the actor's read reach, with its kind, the state core worded,
 * its crew's note and when it last did something. The fleet answers a page
 * at a time (performance S6), so the read goes on from each page's next
 * cursor until it is null. Harbour has no REST door, so it goes over tRPC
 * with the headers a REST call carries.
 */
export function createActiveShips(fleetUrl: string): ActiveShips {
  return {
    list: async (as) => {
      const ships: ListedShip[] = [];
      let cursor: string | undefined;
      do {
        const read = await readAs(fleetUrl, { as, procedure: 'harbour', input: { ...(cursor === undefined ? {} : { cursor }), limit: PAGE_SIZE_MAX }, isTrpcOnly: true });
        if (!read.isOk) {
          return read;
        }
        const page = harbourPageSchema.safeParse(read.value);
        if (!page.success) {
          return err({ code: 'UNAVAILABLE', message: 'The fleet answered no ships' });
        }
        ships.push(...page.data.items.map(({ id, name, kind, state, note, lastActivityAt }) => ({ shipId: id, name, kind, state, note, lastActivityAt })));
        cursor = page.data.nextCursor ?? undefined;
      } while (cursor !== undefined);
      return ok(ships);
    },
  };
}
