/** A fleet-scoped record of rejection replies, found only for the bounded page being read. */
import { idSchema } from '@aeolus-fleet/common';

import type { UnreadableReplies } from '../../core/people/unreadable-replies.js';
import type { Db } from './client.js';

export function createPrismaUnreadableReplies(db: Db): UnreadableReplies {
  return {
    save: async (fleetId, { shipId, messageId }) => {
      const reply = { fleetId, shipId, messageId };
      await db.unreadableReply.createMany({ data: reply, skipDuplicates: true });
    },
    among: async (fleetId, { shipId, messageIds }) => {
      if (messageIds.length === 0) {
        return new Set();
      }
      const rows = await db.unreadableReply.findMany({ where: { fleetId, shipId, messageId: { in: [...messageIds] } }, select: { messageId: true } });
      return new Set(rows.map(({ messageId }) => idSchema('message').parse(messageId)));
    },
  };
}
