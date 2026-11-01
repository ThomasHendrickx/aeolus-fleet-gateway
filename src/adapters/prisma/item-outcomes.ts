import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { ItemOutcome, ItemOutcomes } from '../../core/people/item-outcome.js';
import type { Db } from './client.js';

type ItemOutcomeRow = NonNullable<Awaited<ReturnType<Db['itemOutcome']['findUnique']>>>;

const placeSchema = z.enum(['bridge', 'chat', 'slack', 'gateway']);
const kindSchema = z.enum(['seen', 'answered', 'done', 'cannot', 'withdrawn', 'replaced', 'notSent']);

function seenOf(row: ItemOutcomeRow): ItemOutcome['seen'] {
  return row.seenIn === null || row.seenAt === null ? null : { place: placeSchema.parse(row.seenIn), at: row.seenAt };
}

function outcomeOf(row: ItemOutcomeRow): ItemOutcome {
  return {
    fleetId: idSchema('fleet').parse(row.fleetId),
    shipId: idSchema('ship').parse(row.shipId),
    deliveryId: idSchema('delivery').parse(row.deliveryId),
    place: placeSchema.parse(row.place),
    kind: kindSchema.parse(row.kind),
    option: row.option,
    note: row.note,
    seen: seenOf(row),
    at: row.at,
  };
}

/**
 * What came of each item of a person ship, a row each by fleet, person ship
 * and delivery; the first kept stays, but for one kept as seen, which what
 * came of it after replaces in one statement, keeping where and when it was
 * seen.
 */
export function createPrismaItemOutcomes(db: Db): ItemOutcomes {
  return {
    save: async ({ fleetId, shipId, deliveryId, place, kind, option, note = null, seen = null, at }) => {
      const sighting = kind === 'seen' ? { place, at } : seen;
      await db.$executeRaw`
        INSERT INTO "item_outcomes" ("fleet_id", "ship_id", "delivery_id", "place", "kind", "option", "note", "seen_in", "seen_at", "at")
        VALUES (${fleetId}, ${shipId}, ${deliveryId}, ${place}, ${kind}, ${option}, ${note}, ${sighting?.place ?? null}, ${sighting?.at ?? null}, ${at})
        ON CONFLICT ("fleet_id", "ship_id", "delivery_id") DO UPDATE SET
          "place" = EXCLUDED."place", "kind" = EXCLUDED."kind", "option" = EXCLUDED."option", "note" = EXCLUDED."note", "at" = EXCLUDED."at"
        WHERE "item_outcomes"."kind" = 'seen' AND EXCLUDED."kind" <> 'seen'`;
    },
    findMany: async (fleetId, { shipId, deliveryIds }) => {
      const rows = await db.itemOutcome.findMany({ where: { fleetId, shipId, deliveryId: { in: [...deliveryIds] } } });
      return rows.map(outcomeOf);
    },
  };
}
