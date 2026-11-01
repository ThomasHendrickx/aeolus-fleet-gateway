import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaWakesSent } from '../src/adapters/prisma/wakes-sent.js';
import { migratedDatabase } from './support/database.js';

// What wakes a person, in Postgres (wake a person, W3): when each channel
// last woke their person ship.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const AT = new Date('2026-10-23T09:00:00.000Z');

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('the wakes sent, in Postgres (W3)', () => {
  it('keeps when each channel last woke a person ship, in its fleet only', async () => {
    const wakes = createPrismaWakesSent(prisma);
    const ship = { fleetId: FLEET, shipId: 'shp_01m3tb1zgr5h2ffee12xnch8w1' } as const;
    const later = new Date('2026-10-23T10:00:00.000Z');

    await wakes.record({ ship, channel: 'email', sentAt: AT });
    await wakes.record({ ship, channel: 'email', sentAt: later });

    await expect(
      Promise.all([wakes.lastSentAt(ship, 'email'), wakes.lastSentAt(ship, 'web-push'), wakes.lastSentAt({ ...ship, fleetId: OTHER_FLEET }, 'email')]),
    ).resolves.toEqual([later, undefined, undefined]);
  });
});

describe('forgetting a fleet (decision 0021)', () => {
  it('forgets the wakes sent', async () => {
    const ship = { fleetId: OTHER_FLEET, shipId: 'shp_01m3tb1zgr5h2ffee12xnch8f1' } as const;
    const wakes = createPrismaWakesSent(prisma);
    await wakes.record({ ship, channel: 'email', sentAt: AT });

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    await expect(wakes.lastSentAt(ship, 'email')).resolves.toBeUndefined();
  });
});
