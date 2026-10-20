import { idSchema } from '@aeolus-fleet/common';

import type { OpenedDeliveries } from '../../core/people/ports.js';
import type { Db } from './client.js';

/** The deliveries people opened, a row each by fleet, person ship and delivery. */
export function createPrismaOpenedDeliveries(db: Db): OpenedDeliveries {
  return {
    save: async (opened) => {
      const { fleetId, shipId, deliveryId, ...rest } = opened;
      await db.openedDelivery.upsert({ where: { fleetId_shipId_deliveryId: { fleetId, shipId, deliveryId } }, create: opened, update: rest });
    },
    find: async (fleetId, { shipId, deliveryId }) => {
      const row = await db.openedDelivery.findUnique({ where: { fleetId_shipId_deliveryId: { fleetId, shipId, deliveryId } } });
      return row
        ? {
            fleetId: idSchema('fleet').parse(row.fleetId),
            shipId: idSchema('ship').parse(row.shipId),
            deliveryId: idSchema('delivery').parse(row.deliveryId),
            messageId: idSchema('message').parse(row.messageId),
            senderShipId: idSchema('ship').parse(row.senderShipId),
            from: row.from,
            title: row.title,
            openedAt: row.openedAt,
          }
        : undefined;
    },
    remove: async (fleetId, { shipId, deliveryId }) => {
      await db.openedDelivery.deleteMany({ where: { fleetId, shipId, deliveryId } });
    },
  };
}
