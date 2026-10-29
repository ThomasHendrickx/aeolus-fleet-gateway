import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { OutcomeNotices } from '../../core/requests/ports.js';
import type { Db } from './client.js';

const noticeSchema = z.object({
  fleetId: idSchema('fleet'),
  requestId: z.string(),
  accountId: z.string(),
  personShipId: idSchema('ship'),
  url: z.string(),
  outcome: z.enum(['approved', 'denied', 'expired']),
  partyName: z.string().nullable(),
});

/** The outcomes still to tell in Postgres, written by the pending requests' decide and expire. */
export function createPrismaOutcomeNotices(db: Db): OutcomeNotices {
  return {
    listUnended: async (limit) => {
      const rows = await db.requestOutcomeNotice.findMany({ where: { endedAt: null }, orderBy: { createdAt: 'asc' }, take: limit });
      return rows.map(({ fleetId, requestId, accountId, personShipId, url, outcome, partyName }) => noticeSchema.parse({ fleetId, requestId, accountId, personShipId, url, outcome, partyName }));
    },
    end: async ({ fleetId, requestId, accountId }) => {
      await db.requestOutcomeNotice.updateMany({ where: { fleetId, requestId, accountId, endedAt: null }, data: { endedAt: new Date() } });
    },
  };
}
