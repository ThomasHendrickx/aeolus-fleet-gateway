import { idSchema } from '@aeolus-fleet/common';

import type { OpenedDeliveries } from '../../core/people/ports.js';
import type { Db } from './client.js';

/** The deliveries people opened, a row each by fleet, party and delivery. */
export function createPrismaOpenedDeliveries(db: Db): OpenedDeliveries {
  return {
    save: async (opened) => {
      const { fleetId, party, deliveryId, ...rest } = opened;
      await db.openedDelivery.upsert({ where: { fleetId_party_deliveryId: { fleetId, party, deliveryId } }, create: opened, update: rest });
    },
    find: async (fleetId, { party, deliveryId }) => {
      const row = await db.openedDelivery.findUnique({ where: { fleetId_party_deliveryId: { fleetId, party, deliveryId } } });
      return row
        ? {
            fleetId: idSchema('fleet').parse(row.fleetId),
            party: row.party,
            deliveryId: idSchema('delivery').parse(row.deliveryId),
            messageId: idSchema('message').parse(row.messageId),
            senderShipId: idSchema('ship').parse(row.senderShipId),
            from: row.from,
            title: row.title,
            openedAt: row.openedAt,
          }
        : undefined;
    },
  };
}
