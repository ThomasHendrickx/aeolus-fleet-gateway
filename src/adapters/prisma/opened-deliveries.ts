import { idSchema } from '@aeolus-fleet/common';

import type { OpenedDeliveries, OpenedDelivery } from '../../core/people/ports.js';
import type { Db } from './client.js';

type OpenedDeliveryRow = NonNullable<Awaited<ReturnType<Db['openedDelivery']['findUnique']>>>;

function openedOf(row: OpenedDeliveryRow): OpenedDelivery {
  return {
    fleetId: idSchema('fleet').parse(row.fleetId),
    shipId: idSchema('ship').parse(row.shipId),
    deliveryId: idSchema('delivery').parse(row.deliveryId),
    messageId: idSchema('message').parse(row.messageId),
    senderShipId: idSchema('ship').parse(row.senderShipId),
    from: row.from,
    title: row.title,
    sentAt: row.sentAt,
    openedAt: row.openedAt,
  };
}

/** The deliveries people opened, a row each by fleet, person ship and delivery. */
export function createPrismaOpenedDeliveries(db: Db): OpenedDeliveries {
  return {
    save: async (opened) => {
      const { fleetId, shipId, deliveryId, ...rest } = opened;
      await db.openedDelivery.upsert({ where: { fleetId_shipId_deliveryId: { fleetId, shipId, deliveryId } }, create: opened, update: rest });
    },
    find: async (fleetId, { shipId, deliveryId }) => {
      const row = await db.openedDelivery.findUnique({ where: { fleetId_shipId_deliveryId: { fleetId, shipId, deliveryId } } });
      return row ? openedOf(row) : undefined;
    },
    list: async (fleetId, shipId) => {
      const rows = await db.openedDelivery.findMany({ where: { fleetId, shipId }, orderBy: [{ openedAt: 'asc' }, { deliveryId: 'asc' }] });
      return rows.map(openedOf);
    },
    remove: async (fleetId, { shipId, deliveryId }) => {
      await db.openedDelivery.deleteMany({ where: { fleetId, shipId, deliveryId } });
    },
  };
}
