import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { BasketEntries, BasketEntry } from '../../core/people/basket.js';
import type { Db } from './client.js';

type BasketEntryRow = NonNullable<Awaited<ReturnType<Db['basketEntry']['findUnique']>>>;

const stateSchema = z.enum(['waiting', 'sending', 'refused']);

function entryOf(row: BasketEntryRow): BasketEntry {
  return {
    fleetId: idSchema('fleet').parse(row.fleetId),
    shipId: idSchema('ship').parse(row.shipId),
    questionId: row.questionId,
    deliveryId: idSchema('delivery').parse(row.deliveryId),
    messageId: idSchema('message').parse(row.messageId),
    senderShipId: idSchema('ship').parse(row.senderShipId),
    from: row.from,
    title: row.title,
    sentAt: row.sentAt,
    option: row.option,
    optionLabel: row.optionLabel,
    note: row.note,
    addedAt: row.addedAt,
    state: stateSchema.parse(row.state),
    refusal: row.refusal,
  };
}

/** The basket of each person ship (Bridge, CC21), a row each by fleet, person ship and question. */
export function createPrismaBasketEntries(db: Db): BasketEntries {
  return {
    save: async (entry) => {
      const { fleetId, shipId, questionId, ...rest } = entry;
      await db.basketEntry.upsert({ where: { fleetId_shipId_questionId: { fleetId, shipId, questionId } }, create: entry, update: rest });
    },
    find: async (fleetId, { shipId, questionId }) => {
      const row = await db.basketEntry.findUnique({ where: { fleetId_shipId_questionId: { fleetId, shipId, questionId } } });
      return row ? entryOf(row) : undefined;
    },
    list: async (fleetId, shipId) => {
      const rows = await db.basketEntry.findMany({ where: { fleetId, shipId }, orderBy: [{ addedAt: 'asc' }, { questionId: 'asc' }] });
      return rows.map(entryOf);
    },
    count: (fleetId, shipId) => db.basketEntry.count({ where: { fleetId, shipId } }),
    remove: async (fleetId, { shipId, questionId }) => {
      await db.basketEntry.deleteMany({ where: { fleetId, shipId, questionId } });
    },
    sendingShips: async ({ after, limit }) => {
      // Grouped in the query, so a page is a page of ships, not of their entries.
      const rows = await db.basketEntry.groupBy({
        by: ['fleetId', 'shipId'],
        where: { state: 'sending', ...(after === null ? {} : { OR: [{ fleetId: { gt: after.fleetId } }, { fleetId: after.fleetId, shipId: { gt: after.shipId } }] }) },
        orderBy: [{ fleetId: 'asc' }, { shipId: 'asc' }],
        take: limit,
      });
      return rows.map(({ fleetId, shipId }) => ({ fleetId: idSchema('fleet').parse(fleetId), shipId: idSchema('ship').parse(shipId) }));
    },
  };
}
