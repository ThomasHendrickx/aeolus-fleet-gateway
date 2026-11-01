import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaOpenedDeliveries } from '../src/adapters/prisma/opened-deliveries.js';
import type { OpenedDelivery } from '../src/core/people/ports.js';
import { migratedDatabase } from './support/database.js';

// What the gateway keeps of the deliveries people opened, so their answer
// finds its message and sender once the delivery is acknowledged (Q28 (a)),
// kept per person ship, so every client of the person finds it.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const PERSON_SHIP: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8pp';
const OTHER_PERSON_SHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9dk1';
const AT = new Date('2026-10-19T09:00:00.000Z');

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

function anOpenedDelivery(overrides: Partial<OpenedDelivery> = {}): OpenedDelivery {
  return {
    fleetId: FLEET,
    shipId: PERSON_SHIP,
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001',
    messageId: 'msg_01m3tbfspe96yf1rnr4ank0001',
    senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9trk',
    from: 'tracker',
    title: 'Go for release 1.4?',
    contentType: 'application/vnd.aeolus.question+json',
    askedQuestionId: '9b2f6c1e-4a7d-4e0b-8c3f-2d5a6b7c8d9e',
    withdrawnQuestionId: null,
    stepId: null,
    withdrawnStepId: null,
    stepLink: null,
    sentAt: new Date('2026-10-19T08:00:00.000Z'),
    openedAt: AT,
    ...overrides,
  };
}

describe('the deliveries people opened, in Postgres', () => {
  it("keeps an opened delivery, found by its fleet, person ship and id only", async () => {
    const opened = createPrismaOpenedDeliveries(prisma);
    await opened.save(anOpenedDelivery());

    const found = await Promise.all([
      opened.find(FLEET, { shipId: PERSON_SHIP, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001' }),
      opened.find(FLEET, { shipId: OTHER_PERSON_SHIP, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001' }),
      opened.find(OTHER_FLEET, { shipId: PERSON_SHIP, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001' }),
    ]);

    expect(found).toEqual([anOpenedDelivery(), undefined, undefined]);
  });

  it('reads one opened before the gateway kept its content type with none (Bridge, CC10)', async () => {
    const opened = createPrismaOpenedDeliveries(prisma);
    await opened.save(anOpenedDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0bef', contentType: null }));

    await expect(opened.find(FLEET, { shipId: PERSON_SHIP, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0bef' })).resolves.toMatchObject({ contentType: null });
  });

  it('keeps the question a replacement asks and the one it replaces, so a stale question is known once the replacement is opened (Bridge, CC11)', async () => {
    const opened = createPrismaOpenedDeliveries(prisma);
    const replacement = anOpenedDelivery({
      deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0rep',
      contentType: 'application/vnd.aeolus.question-replacement+json',
      askedQuestionId: '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f',
      withdrawnQuestionId: '9b2f6c1e-4a7d-4e0b-8c3f-2d5a6b7c8d9e',
    });
    await opened.save(replacement);

    await expect(opened.find(FLEET, { shipId: PERSON_SHIP, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0rep' })).resolves.toEqual(replacement);
  });

  it('keeps the step a step replacement asks and the one it replaces, so a stale step is known once the replacement is opened (Bridge, CC14)', async () => {
    const opened = createPrismaOpenedDeliveries(prisma);
    const replacement = anOpenedDelivery({
      deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0rps',
      contentType: 'application/vnd.aeolus.step-replacement+json',
      askedQuestionId: null,
      stepId: '7a2d3b51-6e2c-4c9f-8b62-1d9f4a3b8e21',
      withdrawnStepId: '6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10',
    });
    await opened.save(replacement);

    await expect(opened.find(FLEET, { shipId: PERSON_SHIP, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0rps' })).resolves.toEqual(replacement);
  });

  it('keeps the uuid of the step a step asks, so its outcome names it once the step is acknowledged (Bridge, CC14)', async () => {
    const opened = createPrismaOpenedDeliveries(prisma);
    const step = anOpenedDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0stp', contentType: 'application/vnd.aeolus.step+json', askedQuestionId: null, stepId: '6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10' });
    await opened.save(step);

    await expect(opened.find(FLEET, { shipId: PERSON_SHIP, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0stp' })).resolves.toEqual(step);
  });

  it('keeps the link where a step is done, so its row leads there once the step is opened (aeolus-fleet#1535)', async () => {
    const opened = createPrismaOpenedDeliveries(prisma);
    await opened.save(anOpenedDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0k01', contentType: 'application/vnd.aeolus.step+json', askedQuestionId: null, stepId: '6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10', stepLink: 'https://github.com/new' }));

    await expect(opened.find(FLEET, { shipId: PERSON_SHIP, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0k01' })).resolves.toMatchObject({ stepLink: 'https://github.com/new' });
  });

  it('keeps a delivery opened again once, as last opened', async () => {
    const opened = createPrismaOpenedDeliveries(prisma);
    const deliveryId = 'dlv_01m3tbfspe96yf1rnr4ank0002';
    await opened.save(anOpenedDelivery({ deliveryId }));

    await opened.save(anOpenedDelivery({ deliveryId, openedAt: new Date('2026-10-19T09:05:00.000Z') }));

    await expect(opened.find(FLEET, { shipId: PERSON_SHIP, deliveryId })).resolves.toMatchObject({ openedAt: new Date('2026-10-19T09:05:00.000Z') });
  });

  it('forgets a delivery once the person dealt with it, and only that one', async () => {
    const opened = createPrismaOpenedDeliveries(prisma);
    await opened.save(anOpenedDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0003' }));
    await opened.save(anOpenedDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0004' }));

    await opened.remove(FLEET, { shipId: PERSON_SHIP, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0003' });

    await expect(
      Promise.all([opened.find(FLEET, { shipId: PERSON_SHIP, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0003' }), opened.find(FLEET, { shipId: PERSON_SHIP, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0004' })]),
    ).resolves.toEqual([undefined, anOpenedDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0004' })]);
  });

  it("lists a person ship's opened deliveries, oldest opened first, none of another ship or fleet", async () => {
    const opened = createPrismaOpenedDeliveries(prisma);
    const ship: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8p2';
    const later = anOpenedDelivery({ shipId: ship, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0006', openedAt: new Date('2026-10-19T09:10:00.000Z') });
    const earlier = anOpenedDelivery({ shipId: ship, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0005' });
    await opened.save(later);
    await opened.save(earlier);
    await opened.save(anOpenedDelivery({ shipId: OTHER_PERSON_SHIP, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0007' }));
    await opened.save(anOpenedDelivery({ fleetId: OTHER_FLEET, shipId: ship, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0008' }));

    await expect(opened.list(FLEET, ship)).resolves.toEqual([earlier, later]);
  });

  it('forgets a fleet with the deliveries its people opened (decision 0021)', async () => {
    const opened = createPrismaOpenedDeliveries(prisma);
    await opened.save(anOpenedDelivery({ fleetId: OTHER_FLEET }));

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    await expect(opened.find(OTHER_FLEET, { shipId: PERSON_SHIP, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001' })).resolves.toBeUndefined();
  });
});
