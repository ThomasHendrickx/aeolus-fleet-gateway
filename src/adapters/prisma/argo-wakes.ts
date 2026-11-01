import { idSchema } from '@aeolus-fleet/common';

import type { ArgoWakes } from '../../core/argo-inbox/ports.js';
import type { Db } from './client.js';

/** argo's wakes of each person ship: a row per message covered, and a row per channel with its last argo wake, apart from the person's own. */
export function createPrismaArgoWakes(db: Db): ArgoWakes {
  return {
    coveredOf: async ({ fleetId, shipId }) => {
      const rows = await db.argoMessageCovered.findMany({ where: { fleetId, shipId }, select: { messageId: true } });
      return new Set(rows.map(({ messageId }) => idSchema('message').parse(messageId)));
    },
    cover: async ({ fleetId, shipId }, messageIds) => {
      await db.argoMessageCovered.createMany({ data: messageIds.map((messageId) => ({ fleetId, shipId, messageId })), skipDuplicates: true });
    },
    forgetAllBut: async ({ fleetId, shipId }, open) => {
      await db.argoMessageCovered.deleteMany({ where: { fleetId, shipId, messageId: { notIn: [...open] } } });
    },
    lastSentAt: async ({ fleetId, shipId }, channel) => (await db.argoWakeSent.findUnique({ where: { fleetId_shipId_channel: { fleetId, shipId, channel } } }))?.sentAt,
    record: async ({ ship: { fleetId, shipId }, channel, sentAt }) => {
      await db.argoWakeSent.upsert({ where: { fleetId_shipId_channel: { fleetId, shipId, channel } }, create: { fleetId, shipId, channel, sentAt }, update: { sentAt } });
    },
  };
}
