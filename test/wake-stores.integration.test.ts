import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaEmailChannels } from '../src/adapters/prisma/email-channels.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaWakesSent } from '../src/adapters/prisma/wakes-sent.js';
import { migratedDatabase } from './support/database.js';

// What wakes a person, in Postgres (wake a person, W3, W8): the channels
// they turned on, and when each channel last woke their person ship.

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

describe("a person's email channel in Postgres (W8)", () => {
  it('is off until the person turns it on', async () => {
    const channels = createPrismaEmailChannels(prisma);

    await expect(channels.isOn({ fleetId: FLEET, shipId: 'shp_01m3tb1zgr5h2ffee12xnch8p1' })).resolves.toBe(false);
  });

  it('is on once turned on, in its fleet only', async () => {
    const channels = createPrismaEmailChannels(prisma);
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8p2';

    await channels.turn({ fleetId: FLEET, shipId }, { isOn: true, at: AT });

    await expect(Promise.all([channels.isOn({ fleetId: FLEET, shipId }), channels.isOn({ fleetId: OTHER_FLEET, shipId })])).resolves.toEqual([true, false]);
  });

  it('is off again once turned off, and turning it on twice keeps it on', async () => {
    const channels = createPrismaEmailChannels(prisma);
    const ship = { fleetId: FLEET, shipId: 'shp_01m3tb1zgr5h2ffee12xnch8p3' } as const;
    await channels.turn(ship, { isOn: true, at: AT });
    await channels.turn(ship, { isOn: true, at: AT });
    const twice = await channels.isOn(ship);

    await channels.turn(ship, { isOn: false, at: AT });

    await expect(channels.isOn(ship)).resolves.toBe(false);
    expect(twice).toBe(true);
  });
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
  it("forgets its people's email channels and the wakes sent", async () => {
    const ship = { fleetId: OTHER_FLEET, shipId: 'shp_01m3tb1zgr5h2ffee12xnch8f1' } as const;
    const channels = createPrismaEmailChannels(prisma);
    const wakes = createPrismaWakesSent(prisma);
    await channels.turn(ship, { isOn: true, at: AT });
    await wakes.record({ ship, channel: 'email', sentAt: AT });

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    await expect(Promise.all([channels.isOn(ship), wakes.lastSentAt(ship, 'email')])).resolves.toEqual([false, undefined]);
  });
});
