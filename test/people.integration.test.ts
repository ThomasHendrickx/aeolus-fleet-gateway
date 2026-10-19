import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaOpenedDeliveries } from '../src/adapters/prisma/opened-deliveries.js';
import type { OpenedDelivery } from '../src/core/people/ports.js';
import { migratedDatabase } from './support/database.js';

// What the gateway keeps of the deliveries people opened, so their answer
// finds its message and sender once the delivery is acknowledged (Q28 (a)).

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
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
    party: 'charlotte',
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001',
    messageId: 'msg_01m3tbfspe96yf1rnr4ank0001',
    senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9trk',
    from: 'tracker',
    title: 'Go for release 1.4?',
    openedAt: AT,
    ...overrides,
  };
}

describe('the deliveries people opened, in Postgres', () => {
  it("keeps an opened delivery, found by its fleet, party and id only", async () => {
    const opened = createPrismaOpenedDeliveries(prisma);
    await opened.save(anOpenedDelivery());

    const found = await Promise.all([
      opened.find(FLEET, { party: 'charlotte', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001' }),
      opened.find(FLEET, { party: 'dirk', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001' }),
      opened.find(OTHER_FLEET, { party: 'charlotte', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001' }),
    ]);

    expect(found).toEqual([anOpenedDelivery(), undefined, undefined]);
  });

  it('keeps a delivery opened again once, as last opened', async () => {
    const opened = createPrismaOpenedDeliveries(prisma);
    const deliveryId = 'dlv_01m3tbfspe96yf1rnr4ank0002';
    await opened.save(anOpenedDelivery({ deliveryId }));

    await opened.save(anOpenedDelivery({ deliveryId, openedAt: new Date('2026-10-19T09:05:00.000Z') }));

    await expect(opened.find(FLEET, { party: 'charlotte', deliveryId })).resolves.toMatchObject({ openedAt: new Date('2026-10-19T09:05:00.000Z') });
  });

  it('forgets a fleet with the deliveries its people opened (decision 0021)', async () => {
    const opened = createPrismaOpenedDeliveries(prisma);
    await opened.save(anOpenedDelivery({ fleetId: OTHER_FLEET }));

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    await expect(opened.find(OTHER_FLEET, { party: 'charlotte', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001' })).resolves.toBeUndefined();
  });
});
