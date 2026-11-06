import { idSchema } from '@aeolus-fleet/common';

import type { QuietHoursStore } from '../../core/people/quiet-hours.js';
import type { QuietShip, QuietShips } from '../../core/people/quiet-ships.js';
import type { Db } from './client.js';

/** Each person's quiet hours, a row per fleet and person ship (preferences design). */
export function createPrismaQuietHours(db: Db): QuietHoursStore {
  return {
    find: async ({ fleetId, shipId }) => {
      const row = await db.quietHours.findUnique({ where: { fleetId_shipId: { fleetId, shipId } } });
      return row === null ? undefined : { fleetId, shipId, isOn: row.isOn, fromMinute: row.fromMinute, toMinute: row.toMinute, timeZone: row.timeZone, changedAt: row.changedAt };
    },
    save: async ({ fleetId, shipId, ...chosen }) => {
      await db.quietHours.upsert({ where: { fleetId_shipId: { fleetId, shipId } }, create: { fleetId, shipId, ...chosen }, update: chosen });
    },
  };
}

/**
 * Each person's quiet ships, a row per fleet, person ship and ship they
 * quieted or woke again (preferences design). The quiet ones are listed the
 * latest quieted first, by the index on when, the ship id breaking a tie, so
 * a page after the cursor holds none twice.
 */
export function createPrismaQuietShips(db: Db): QuietShips {
  return {
    among: async (ship, shipIds) => {
      if (shipIds.length === 0) {
        return [];
      }
      const rows = await db.quietShip.findMany({ where: { fleetId: ship.fleetId, shipId: ship.shipId, quietShipId: { in: [...shipIds] } } });
      return rows.map((row) => quietShipOf(ship, row));
    },
    listQuiet: async (ship, { cursor, limit }) => {
      const where = { fleetId: ship.fleetId, shipId: ship.shipId, isQuiet: true };
      const after = cursor === null ? null : await db.quietShip.findUnique({ where: { fleetId_shipId_quietShipId: { ...ship, quietShipId: cursor } } });
      const rows = await db.quietShip.findMany({
        where: after === null ? where : { ...where, OR: [{ changedAt: { lt: after.changedAt } }, { changedAt: after.changedAt, quietShipId: { lt: after.quietShipId } }] },
        orderBy: [{ changedAt: 'desc' }, { quietShipId: 'desc' }],
        // One more than the page tells whether another follows.
        take: limit + 1,
      });
      const ships = rows.slice(0, limit).map((row) => quietShipOf(ship, row));
      return { ships, nextCursor: rows.length > limit ? (ships.at(-1)?.quietShipId ?? null) : null };
    },
    save: async ({ fleetId, shipId, quietShipId, ...chosen }) => {
      await db.quietShip.upsert({ where: { fleetId_shipId_quietShipId: { fleetId, shipId, quietShipId } }, create: { fleetId, shipId, quietShipId, ...chosen }, update: chosen });
    },
  };
}

function quietShipOf(ship: Pick<QuietShip, 'fleetId' | 'shipId'>, row: { quietShipId: string; name: string; isQuiet: boolean; changedAt: Date }): QuietShip {
  return { fleetId: ship.fleetId, shipId: ship.shipId, quietShipId: idSchema('ship').parse(row.quietShipId), name: row.name, isQuiet: row.isQuiet, changedAt: row.changedAt };
}
