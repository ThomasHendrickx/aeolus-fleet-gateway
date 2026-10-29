import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaPersonCrews } from '../src/adapters/prisma/person-crews.js';
import { migratedDatabase } from './support/database.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const PERSON_SHIP: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8pp';
const AT = new Date('2026-10-19T09:00:00.000Z');

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("person ships' crews in Postgres (decision 0054)", () => {
  it('keeps the crew token of a person ship in its fleet only', async () => {
    const crews = createPrismaPersonCrews(prisma);
    await crews.save({ fleetId: FLEET, shipId: PERSON_SHIP, crewToken: 'aeolus_ct_v1_person_1', crewedAt: AT });

    await expect(Promise.all([crews.find(FLEET, PERSON_SHIP), crews.find(OTHER_FLEET, PERSON_SHIP)])).resolves.toEqual([
      { fleetId: FLEET, shipId: PERSON_SHIP, crewToken: 'aeolus_ct_v1_person_1', crewedAt: AT },
      undefined,
    ]);
  });

  it('forgets a crew that no longer works, in its fleet only', async () => {
    const crews = createPrismaPersonCrews(prisma);
    const LEASED_SHIP: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8pq';
    await crews.save({ fleetId: FLEET, shipId: LEASED_SHIP, crewToken: 'aeolus_ct_v1_person_2', crewedAt: AT });
    await crews.save({ fleetId: OTHER_FLEET, shipId: LEASED_SHIP, crewToken: 'aeolus_ct_v1_person_3', crewedAt: AT });

    await crews.drop(FLEET, LEASED_SHIP);

    await expect(Promise.all([crews.find(FLEET, LEASED_SHIP), crews.find(OTHER_FLEET, LEASED_SHIP)])).resolves.toEqual([
      undefined,
      { fleetId: OTHER_FLEET, shipId: LEASED_SHIP, crewToken: 'aeolus_ct_v1_person_3', crewedAt: AT },
    ]);
  });

  it('lists the person ships it holds a crew for, of every fleet, a page at a time after the last one listed (wake a person, W7)', async () => {
    const crews = createPrismaPersonCrews(prisma);
    const fleetId: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch9zz';
    for (const shipId of ['shp_01m3tb1zgr5h2ffee12xnch9a1', 'shp_01m3tb1zgr5h2ffee12xnch9a2', 'shp_01m3tb1zgr5h2ffee12xnch9a3'] as const) {
      await crews.save({ fleetId, shipId, crewToken: `aeolus_ct_v1_${shipId}`, crewedAt: AT });
    }

    const first = await crews.crewed({ after: { fleetId, shipId: 'shp_01m3tb1zgr5h2ffee12xnch9a0' }, limit: 2 });
    const next = await crews.crewed({ after: first.at(-1) ?? null, limit: 2 });

    expect({ first, next }).toEqual({
      first: [
        { fleetId, shipId: 'shp_01m3tb1zgr5h2ffee12xnch9a1' },
        { fleetId, shipId: 'shp_01m3tb1zgr5h2ffee12xnch9a2' },
      ],
      next: [{ fleetId, shipId: 'shp_01m3tb1zgr5h2ffee12xnch9a3' }],
    });
  });

  it('forgets a fleet with its person ships\' crews (decision 0021)', async () => {
    const crews = createPrismaPersonCrews(prisma);
    await crews.save({ fleetId: OTHER_FLEET, shipId: PERSON_SHIP, crewToken: 'aeolus_ct_v1_person_o', crewedAt: AT });

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    await expect(crews.find(OTHER_FLEET, PERSON_SHIP)).resolves.toBeUndefined();
  });
});
