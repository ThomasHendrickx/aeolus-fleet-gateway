/** The browsers people turned web push on in, a row each by fleet, person ship and endpoint (wake a person, W8). */
import { idSchema } from '@aeolus-fleet/common';

import type { WebPushSubscription, WebPushSubscriptions } from '../../core/people/ports.js';
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

