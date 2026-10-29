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
