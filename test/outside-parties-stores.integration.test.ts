import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaOutsidePartySwitches } from '../src/adapters/prisma/outside-party-switches.js';
import { migratedDatabase } from './support/database.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const AT = new Date('2026-10-20T12:00:00.000Z');

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("a fleet's outside parties switch in Postgres (interop I-3)", () => {
  it('is off for a fleet never switched, and on or off per fleet as last set', async () => {
    const switches = createPrismaOutsidePartySwitches(prisma);
    await expect(switches.isOn(FLEET)).resolves.toBe(false);

    await switches.set(FLEET, { isOn: true, at: AT });
    await switches.set(OTHER_FLEET, { isOn: true, at: AT });
    await switches.set(OTHER_FLEET, { isOn: false, at: AT });

    await expect(Promise.all([switches.isOn(FLEET), switches.isOn(OTHER_FLEET)])).resolves.toEqual([true, false]);
  });

  it('forgets a fleet with its switch (decision 0021)', async () => {
    const switches = createPrismaOutsidePartySwitches(prisma);
    const fleet: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8x2';
    await switches.set(fleet, { isOn: true, at: AT });

    await createPrismaFleetForgetter(prisma).forget(fleet);

    await expect(switches.isOn(fleet)).resolves.toBe(false);
  });
});
