import { idSchema, type MessageId } from '@aeolus-fleet/common';

import type { ArgoWakes } from '../../core/argo-inbox/ports.js';
import type { Db } from './client.js';

/** How many messages one statement names at most, so a long list of them is read and written in pages. */
const PAGE = 500;

function pagesOf<T>(items: readonly T[]): T[][] {
  const pages: T[][] = [];
  for (let start = 0; start < items.length; start += PAGE) {
    pages.push(items.slice(start, start + PAGE));
  }
  return pages;
}

/** argo's wakes of each person ship: a row per message covered, and a row per channel with its last argo wake, apart from the person's own. Each read names the messages it asks about, by the primary key. */
export function createPrismaArgoWakes(db: Db): ArgoWakes {
  return {
    coveredAmong: async ({ fleetId, shipId }, messageIds) => {
      const covered = new Set<MessageId>();
      for (const page of pagesOf(messageIds)) {
        const rows = await db.argoMessageCovered.findMany({ where: { fleetId, shipId, messageId: { in: page } }, select: { messageId: true } });
        rows.forEach(({ messageId }) => covered.add(idSchema('message').parse(messageId)));
      }
      return covered;
    },
    cover: async ({ fleetId, shipId }, messageIds) => {
      for (const page of pagesOf(messageIds)) {
        await db.argoMessageCovered.createMany({ data: page.map((messageId) => ({ fleetId, shipId, messageId })), skipDuplicates: true });
      }
    },
    forget: async ({ fleetId, shipId }, messageIds) => {
      for (const page of pagesOf(messageIds)) {
        await db.argoMessageCovered.deleteMany({ where: { fleetId, shipId, messageId: { in: page } } });
      }
    },
    // Read by a cursor over the person ship's rows, a page at a time, as an open inbox may be too long for one statement.
    forgetAllBut: async ({ fleetId, shipId }, open) => {
      const isOpen = new Set<string>(open);
      let after: string | undefined;
      for (;;) {
        const rows = await db.argoMessageCovered.findMany({ where: { fleetId, shipId, ...(after === undefined ? {} : { messageId: { gt: after } }) }, select: { messageId: true }, orderBy: { messageId: 'asc' }, take: PAGE });
        const done = rows.map(({ messageId }) => messageId).filter((messageId) => !isOpen.has(messageId));
        if (done.length > 0) {
          await db.argoMessageCovered.deleteMany({ where: { fleetId, shipId, messageId: { in: done } } });
        }
        after = rows.at(-1)?.messageId;
        if (rows.length < PAGE || after === undefined) {
          return;
        }
      }
    },
    lastSentAt: async ({ fleetId, shipId }, channel) => (await db.argoWakeSent.findUnique({ where: { fleetId_shipId_channel: { fleetId, shipId, channel } } }))?.sentAt,
    record: async ({ ship: { fleetId, shipId }, channel, sentAt }) => {
      await db.argoWakeSent.upsert({ where: { fleetId_shipId_channel: { fleetId, shipId, channel } }, create: { fleetId, shipId, channel, sentAt }, update: { sentAt } });
    },
  };
}
