import type { FocusedPages } from '../../core/people/ports.js';
import type { Db } from './client.js';

/** A person's pages in focus on every gateway instance, a row each by fleet and page (wake a person, W6). */
export function createPrismaFocusedPages(db: Db): FocusedPages {
  return {
    save: async ({ fleetId, pageId, shipId, seenAt }) => {
      await db.focusedPage.upsert({ where: { fleetId_pageId: { fleetId, pageId } }, create: { fleetId, pageId, shipId, seenAt }, update: { seenAt } });
    },
    remove: async (fleetId, pageId) => {
      await db.focusedPage.deleteMany({ where: { fleetId, pageId } });
    },
    isAnyInFocus: async ({ fleetId, shipId }, since) => (await db.focusedPage.findFirst({ where: { fleetId, shipId, seenAt: { gte: since } }, select: { pageId: true } })) !== null,
  };
}
