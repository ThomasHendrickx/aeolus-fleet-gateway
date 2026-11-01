import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaBasketEntries } from '../src/adapters/prisma/basket-entries.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import type { BasketEntry } from '../src/core/people/basket.js';
import { migratedDatabase } from './support/database.js';

// The basket lives in the gateway's database, per fleet and person ship
// (Bridge, CC21): a closed tab or another device shows the same basket, and
// a gateway restart while sending goes on with what it stored as sending.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

function anEntry(overrides: Partial<BasketEntry> = {}): BasketEntry {
  return {
    fleetId: FLEET,
    shipId: 'shp_01m3tb1zgr5h2ffee12xnch8pp',
    questionId: '9b2f6c1e-4a7d-4e0b-8c3f-2d5a6b7c8d9e',
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001',
    messageId: 'msg_01m3tbfspe96yf1rnr4ank0001',
    senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9qrc',
    from: 'orchestrator-1',
    title: 'Which goes first: the Compact look (U4) or Harbour?',
    sentAt: new Date('2026-10-31T19:41:00.000Z'),
    option: 2,
    note: 'Harbour first: the demo on 12 Nov needs it.',
    addedAt: new Date('2026-10-31T19:53:00.000Z'),
    state: 'waiting',
    refusal: null,
    ...overrides,
  };
}

describe('the basket in Postgres', () => {
  it('keeps an entry, found by its fleet, person ship and question only', async () => {
    const entries = createPrismaBasketEntries(prisma);
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8p1';
    await entries.save(anEntry({ shipId }));

    const found = await Promise.all([
      entries.find(FLEET, { shipId, questionId: anEntry().questionId }),
      entries.find(FLEET, { shipId: 'shp_01m3tb1zgr5h2ffee12xnch8p9', questionId: anEntry().questionId }),
      entries.find(OTHER_FLEET, { shipId, questionId: anEntry().questionId }),
    ]);

    expect(found).toEqual([anEntry({ shipId }), undefined, undefined]);
  });

  it('keeps one entry per question: saving it again changes it', async () => {
    const entries = createPrismaBasketEntries(prisma);
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8p2';
    await entries.save(anEntry({ shipId }));

    await entries.save(anEntry({ shipId, option: 3, note: null, state: 'refused', refusal: 'orchestrator-1 did not take the answer: retired' }));

    await expect(entries.list(FLEET, shipId)).resolves.toEqual([anEntry({ shipId, option: 3, note: null, state: 'refused', refusal: 'orchestrator-1 did not take the answer: retired' })]);
  });

  it('keeps an entry with a note and no option, answering with the note alone', async () => {
    const entries = createPrismaBasketEntries(prisma);
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8p7';
    await entries.save(anEntry({ shipId, option: null, note: 'Neither: ask me after the demo.' }));

    await expect(entries.list(FLEET, shipId)).resolves.toEqual([anEntry({ shipId, option: null, note: 'Neither: ask me after the demo.' })]);
  });

  it("lists a person ship's entries in the order added, and counts them, none of another ship or fleet", async () => {
    const entries = createPrismaBasketEntries(prisma);
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8p3';
    const later = anEntry({ shipId, questionId: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b', addedAt: new Date('2026-10-31T19:55:00.000Z') });
    const earlier = anEntry({ shipId });
    await entries.save(later);
    await entries.save(earlier);
    await entries.save(anEntry({ shipId: 'shp_01m3tb1zgr5h2ffee12xnch8p4' }));
    await entries.save(anEntry({ fleetId: OTHER_FLEET, shipId }));

    const [listed, counted] = await Promise.all([entries.list(FLEET, shipId), entries.count(FLEET, shipId)]);

    expect({ listed, counted }).toEqual({ listed: [earlier, later], counted: 2 });
  });

  it('removes an entry, and only that one', async () => {
    const entries = createPrismaBasketEntries(prisma);
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8p5';
    await entries.save(anEntry({ shipId }));
    await entries.save(anEntry({ shipId, questionId: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b' }));

    await entries.remove(FLEET, { shipId, questionId: anEntry().questionId });

    await expect(entries.list(FLEET, shipId)).resolves.toEqual([anEntry({ shipId, questionId: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b' })]);
  });

  it('lists the person ships with an entry stored as sending, of every fleet, a page at a time, so a restart goes on sending them', async () => {
    const entries = createPrismaBasketEntries(prisma);
    const sendingShips: ShipId[] = ['shp_01m3tb1zgr5h2ffee12xnch8s1', 'shp_01m3tb1zgr5h2ffee12xnch8s2', 'shp_01m3tb1zgr5h2ffee12xnch8s3'];
    for (const shipId of sendingShips) {
      await entries.save(anEntry({ fleetId: OTHER_FLEET, shipId, state: 'sending' }));
      await entries.save(anEntry({ fleetId: OTHER_FLEET, shipId, questionId: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b', state: 'sending' }));
    }
    await entries.save(anEntry({ fleetId: OTHER_FLEET, shipId: 'shp_01m3tb1zgr5h2ffee12xnch8s4', state: 'waiting' }));
    await entries.save(anEntry({ fleetId: OTHER_FLEET, shipId: 'shp_01m3tb1zgr5h2ffee12xnch8s5', state: 'refused', refusal: 'retired' }));

    const first = await entries.sendingShips({ after: null, limit: 2 });
    const next = await entries.sendingShips({ after: first.at(-1) ?? null, limit: 2 });

    expect([...first, ...next].filter(({ fleetId }) => fleetId === OTHER_FLEET)).toEqual(sendingShips.map((shipId) => ({ fleetId: OTHER_FLEET, shipId })));
  });

  it('forgets a fleet with its baskets (decision 0021)', async () => {
    const entries = createPrismaBasketEntries(prisma);
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8p6';
    const forgottenFleet: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8fg';
    await entries.save(anEntry({ fleetId: forgottenFleet, shipId }));

    await createPrismaFleetForgetter(prisma).forget(forgottenFleet);

    await expect(entries.list(forgottenFleet, shipId)).resolves.toEqual([]);
  });
});
