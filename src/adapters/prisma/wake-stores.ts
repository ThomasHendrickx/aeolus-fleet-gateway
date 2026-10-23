/**
 * What the gateway keeps to wake a person (wake a person, W3, W6, W8), each
 * by fleet and person ship: the browsers they turned web push on in, when
 * each channel last woke them, and their pages in focus on any instance.
 */
import { idSchema } from '@aeolus-fleet/common';

import type { FocusedPages, PersonWakes, WebPushSubscription, WebPushSubscriptions } from '../../core/people/ports.js';
import type { Db } from './client.js';

type WebPushSubscriptionRow = NonNullable<Awaited<ReturnType<Db['webPushSubscription']['findUnique']>>>;

function subscriptionOf(row: WebPushSubscriptionRow): WebPushSubscription {
  return {
    fleetId: idSchema('fleet').parse(row.fleetId),
    shipId: idSchema('ship').parse(row.shipId),
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
    browser: row.browser,
    fleetName: row.fleetName,
    addedAt: row.addedAt,
    goneAt: row.goneAt,
  };
}

export function createPrismaWebPushSubscriptions(db: Db): WebPushSubscriptions {
  return {
    list: async (fleetId, shipId) => {
      const rows = await db.webPushSubscription.findMany({ where: { fleetId, shipId }, orderBy: [{ addedAt: 'asc' }, { endpoint: 'asc' }] });
      return rows.map(subscriptionOf);
    },
    save: async ({ fleetId, shipId, endpoint, keys, ...rest }) => {
      const kept = { ...rest, p256dh: keys.p256dh, auth: keys.auth };
      await db.webPushSubscription.upsert({ where: { fleetId_shipId_endpoint: { fleetId, shipId, endpoint } }, create: { fleetId, shipId, endpoint, ...kept }, update: kept });
    },
    markGone: async (fleetId, { shipId, endpoint, goneAt }) => {
      await db.webPushSubscription.updateMany({ where: { fleetId, shipId, endpoint }, data: { goneAt } });
    },
    remove: async (fleetId, { shipId, endpoint }) => {
      await db.webPushSubscription.deleteMany({ where: { fleetId, shipId, endpoint } });
    },
  };
}

export function createPrismaPersonWakes(db: Db): PersonWakes {
  return {
    lastWokenAt: async ({ fleetId, shipId }, channel) => {
      const row = await db.personWake.findUnique({ where: { fleetId_shipId_channel: { fleetId, shipId, channel } } });
      return row?.lastWokenAt;
    },
    record: async ({ fleetId, shipId }, { channel, at }) => {
      await db.personWake.upsert({ where: { fleetId_shipId_channel: { fleetId, shipId, channel } }, create: { fleetId, shipId, channel, lastWokenAt: at }, update: { lastWokenAt: at } });
    },
  };
}

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
