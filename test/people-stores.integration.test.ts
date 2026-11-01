import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaItemOutcomes } from '../src/adapters/prisma/item-outcomes.js';
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

describe("what came of a person ship's items, in Postgres (Bridge, CC4)", () => {
  const outcome = { fleetId: FLEET, shipId: PERSON_SHIP, deliveryId: 'dlv_01m3tb1zgr5h2ffee12xnch801', place: 'slack', kind: 'answered', option: 2, at: AT } as const;

  it('keeps the first outcome of a delivery: a later one changes nothing', async () => {
    const outcomes = createPrismaItemOutcomes(prisma);
    await outcomes.save(outcome);

    await outcomes.save({ ...outcome, place: 'bridge', kind: 'done', option: null, at: new Date('2026-10-19T10:00:00.000Z') });

    await expect(outcomes.findMany(FLEET, { shipId: PERSON_SHIP, deliveryIds: [outcome.deliveryId] })).resolves.toEqual([{ ...outcome, note: null, seen: null }]);
  });

  it('keeps the note the person sent with the outcome, and where and when they saw the item first (Bridge, Done)', async () => {
    const outcomes = createPrismaItemOutcomes(prisma);
    const cannot = { ...outcome, deliveryId: 'dlv_01m3tb1zgr5h2ffee12xnch811', place: 'bridge', kind: 'cannot', option: null, note: 'The name is taken by an archived repository of mine.', seen: { place: 'bridge', at: new Date('2026-10-19T08:55:00.000Z') } } as const;
    await outcomes.save(cannot);

    await expect(outcomes.findMany(FLEET, { shipId: PERSON_SHIP, deliveryIds: [cannot.deliveryId] })).resolves.toEqual([cannot]);
  });

  it('keeps an item seen as seen where and when it was seen', async () => {
    const outcomes = createPrismaItemOutcomes(prisma);
    const seen = { ...outcome, deliveryId: 'dlv_01m3tb1zgr5h2ffee12xnch812', place: 'slack', kind: 'seen', option: null } as const;
    await outcomes.save(seen);

    await expect(outcomes.findMany(FLEET, { shipId: PERSON_SHIP, deliveryIds: [seen.deliveryId] })).resolves.toEqual([{ ...seen, note: null, seen: { place: 'slack', at: AT } }]);
  });

  it('keeps what came of an item seen before in place of seen, still saying where and when it was seen (Bridge, Done)', async () => {
    const outcomes = createPrismaItemOutcomes(prisma);
    const seen = { ...outcome, deliveryId: 'dlv_01m3tb1zgr5h2ffee12xnch813', place: 'slack', kind: 'seen', option: null, at: new Date('2026-10-19T08:57:00.000Z') } as const;
    await outcomes.save(seen);

    await outcomes.save({ ...outcome, deliveryId: seen.deliveryId, place: 'slack', kind: 'answered', option: 2, at: new Date('2026-10-19T08:58:00.000Z') });

    await expect(outcomes.findMany(FLEET, { shipId: PERSON_SHIP, deliveryIds: [seen.deliveryId] })).resolves.toEqual([
      { ...outcome, deliveryId: seen.deliveryId, place: 'slack', kind: 'answered', option: 2, at: new Date('2026-10-19T08:58:00.000Z'), note: null, seen: { place: 'slack', at: new Date('2026-10-19T08:57:00.000Z') } },
    ]);
  });

  it('finds only the deliveries asked, of the person ship asked, in its fleet', async () => {
    const outcomes = createPrismaItemOutcomes(prisma);
    const asked = { ...outcome, deliveryId: 'dlv_01m3tb1zgr5h2ffee12xnch802', place: 'bridge', kind: 'seen', option: null } as const;
    await outcomes.save(asked);
    await outcomes.save({ ...asked, deliveryId: 'dlv_01m3tb1zgr5h2ffee12xnch803' });
    await outcomes.save({ ...asked, fleetId: OTHER_FLEET });
    await outcomes.save({ ...asked, shipId: 'shp_01m3tb1zgr5h2ffee12xnch8pq' });

    await expect(outcomes.findMany(FLEET, { shipId: PERSON_SHIP, deliveryIds: [asked.deliveryId] })).resolves.toEqual([{ ...asked, note: null, seen: { place: 'bridge', at: AT } }]);
  });

  it('keeps a question its asker withdrew or replaced as withdrawn or replaced (Bridge, CC11)', async () => {
    const outcomes = createPrismaItemOutcomes(prisma);
    const withdrawn = { ...outcome, deliveryId: 'dlv_01m3tb1zgr5h2ffee12xnch805', place: 'bridge', kind: 'withdrawn', option: null } as const;
    const replaced = { ...withdrawn, deliveryId: 'dlv_01m3tb1zgr5h2ffee12xnch806', kind: 'replaced' } as const;
    await outcomes.save(withdrawn);
    await outcomes.save(replaced);

    await expect(outcomes.findMany(FLEET, { shipId: PERSON_SHIP, deliveryIds: [withdrawn.deliveryId, replaced.deliveryId] })).resolves.toEqual(expect.arrayContaining([{ ...withdrawn, note: null, seen: null }, { ...replaced, note: null, seen: null }]));
  });

  it('keeps a step the person cannot do as cannot, and one of the gateway it saw complete as done by the gateway (Bridge, CC14)', async () => {
    const outcomes = createPrismaItemOutcomes(prisma);
    const cannot = { ...outcome, deliveryId: 'dlv_01m3tb1zgr5h2ffee12xnch807', place: 'chat', kind: 'cannot', option: null } as const;
    const doneByGateway = { ...outcome, deliveryId: 'dlv_01m3tb1zgr5h2ffee12xnch808', place: 'gateway', kind: 'done', option: null } as const;
    await outcomes.save(cannot);
    await outcomes.save(doneByGateway);

    await expect(outcomes.findMany(FLEET, { shipId: PERSON_SHIP, deliveryIds: [cannot.deliveryId, doneByGateway.deliveryId] })).resolves.toEqual(expect.arrayContaining([{ ...cannot, note: null, seen: null }, { ...doneByGateway, note: null, seen: null }]));
  });

  it('forgets a fleet with what came of its items (decision 0021)', async () => {
    const outcomes = createPrismaItemOutcomes(prisma);
    const forgotten = { ...outcome, fleetId: OTHER_FLEET, deliveryId: 'dlv_01m3tb1zgr5h2ffee12xnch804' } as const;
    await outcomes.save(forgotten);

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    await expect(outcomes.findMany(OTHER_FLEET, { shipId: PERSON_SHIP, deliveryIds: [forgotten.deliveryId] })).resolves.toEqual([]);
  });
});
