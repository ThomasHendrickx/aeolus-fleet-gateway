import { idSchema } from '@aeolus-fleet/common';

import type { PersonCrews } from '../../core/people/ports.js';
import type { Db } from './client.js';

/** The crews the gateway holds for person ships, one per ship in its fleet (decision 0054). */
export function createPrismaPersonCrews(db: Db): PersonCrews {
  return {
    crewed: async ({ after, limit }) => {
      const rows = await db.personCrew.findMany({
        where: after === null ? {} : { OR: [{ fleetId: { gt: after.fleetId } }, { fleetId: after.fleetId, shipId: { gt: after.shipId } }] },
        orderBy: [{ fleetId: 'asc' }, { shipId: 'asc' }],
        select: { fleetId: true, shipId: true },
        take: limit,
      });
      return rows.map((row) => ({ fleetId: idSchema('fleet').parse(row.fleetId), shipId: idSchema('ship').parse(row.shipId) }));
    },
    find: async (fleetId, shipId) => {
      const row = await db.personCrew.findUnique({ where: { fleetId_shipId: { fleetId, shipId } } });
      return row ? { fleetId: idSchema('fleet').parse(row.fleetId), shipId: idSchema('ship').parse(row.shipId), crewToken: row.crewToken, crewedAt: row.crewedAt } : undefined;
    },
    save: async (crew) => {
      const { fleetId, shipId, crewToken, crewedAt } = crew;
      await db.personCrew.upsert({ where: { fleetId_shipId: { fleetId, shipId } }, create: { fleetId, shipId, crewToken, crewedAt }, update: { crewToken, crewedAt } });
    },
    drop: async (fleetId, shipId) => {
      await db.personCrew.deleteMany({ where: { fleetId, shipId } });
    },
  };
}
