import { idSchema } from '@aeolus-fleet/common';
import { Prisma } from './generated/client.js';
import { z } from 'zod';

import type { Call, CallStore, Reply } from '../../core/mcp-out/hand-call.js';
import type { Db } from './client.js';

const replySchema: z.ZodType<Reply> = z.object({
  to: idSchema('ship'),
  inReplyTo: idSchema('message'),
  contentType: z.string(),
  payload: z.string(),
  idempotencyKey: z.string(),
});

const stateSchema = z.enum(['calling', 'notSent', 'answered', 'mayHaveRun', 'done']);

/** The gateway's calls, one row per delivery. */
export function createPrismaCalls(db: Db): CallStore {
  return {
    find: async (deliveryId) => {
      const row = await db.call.findUnique({ where: { deliveryId } });
      if (!row) {
        return undefined;
      }
      const call: Call = {
        deliveryId: idSchema('delivery').parse(row.deliveryId),
        fleetId: idSchema('fleet').parse(row.fleetId),
        party: row.party,
        state: stateSchema.parse(row.state),
        reply: row.reply === null ? null : replySchema.parse(row.reply),
      };
      return call;
    },
    save: async (call) => {
      const columns = { fleetId: call.fleetId, party: call.party, state: call.state, reply: call.reply === null ? Prisma.DbNull : { ...call.reply } };
      await db.call.upsert({ where: { deliveryId: call.deliveryId }, create: { deliveryId: call.deliveryId, ...columns }, update: columns });
    },
  };
}
