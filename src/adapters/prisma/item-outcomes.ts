import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { ItemOutcome, ItemOutcomes } from '../../core/people/item-outcome.js';
import type { Db } from './client.js';

type ItemOutcomeRow = NonNullable<Awaited<ReturnType<Db['itemOutcome']['findUnique']>>>;

const placeSchema = z.enum(['bridge', 'chat', 'slack', 'gateway']);
const kindSchema = z.enum(['seen', 'answered', 'done', 'cannot', 'withdrawn', 'replaced', 'notSent']);

function outcomeOf(row: ItemOutcomeRow): ItemOutcome {
  return {
    fleetId: idSchema('fleet').parse(row.fleetId),
    shipId: idSchema('ship').parse(row.shipId),
    deliveryId: idSchema('delivery').parse(row.deliveryId),
    place: placeSchema.parse(row.place),
    kind: kindSchema.parse(row.kind),
    option: row.option,
    at: row.at,
  };
}

/** What came of each item of a person ship, a row each by fleet, person ship and delivery; the first kept stays. */
export function createPrismaItemOutcomes(db: Db): ItemOutcomes {
  return {
    save: async (outcome) => {
      await db.itemOutcome.createMany({ data: [outcome], skipDuplicates: true });
    },
    findMany: async (fleetId, { shipId, deliveryIds }) => {
      const rows = await db.itemOutcome.findMany({ where: { fleetId, shipId, deliveryId: { in: [...deliveryIds] } } });
      return rows.map(outcomeOf);
    },
  };
}
