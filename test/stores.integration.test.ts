import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaConnectionStore } from '../src/adapters/prisma/connection-store.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaFleetSwitches } from '../src/adapters/prisma/fleet-switches.js';
import { createPrismaInstallationRequests } from '../src/adapters/prisma/installation-requests.js';
import { migratedDatabase } from './support/database.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const SHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1a';
const AT = new Date('2026-10-18T12:00:00.000Z');

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the gateway's connections in Postgres", () => {
  it('keeps a crew per fleet, and its binding once the crew token is dropped', async () => {
    const store = createPrismaConnectionStore(prisma);
    await store.save({ fleetId: FLEET, shipId: SHIP, name: 'gateway', crewToken: 'aeolus_ct_v1_1', crewedAt: AT });
    await expect(store.connected()).resolves.toEqual([{ fleetId: FLEET, shipId: SHIP, name: 'gateway', crewToken: 'aeolus_ct_v1_1', crewedAt: AT }]);

    await store.drop(FLEET);

    await expect(Promise.all([store.find(FLEET), store.binding(FLEET)])).resolves.toEqual([undefined, { fleetId: FLEET, shipId: SHIP }]);
  });
});

describe('the installation in Postgres', () => {
  it('keeps each fleet switch, and forgets one fleet whole', async () => {
    const switches = createPrismaFleetSwitches(prisma);
    const requests = createPrismaInstallationRequests(prisma);
    await switches.set(FLEET, { isEnabled: true, at: AT });
    await switches.set(OTHER_FLEET, { isEnabled: true, at: AT });
    await requests.record({ requestId: 'r-1', kind: 'setEnabled', requestHash: 'h', fleetId: FLEET, isEnabled: true, at: AT });

    await createPrismaFleetForgetter(prisma).forget(FLEET);

    await expect(Promise.all([switches.find(FLEET), switches.find(OTHER_FLEET), requests.find('r-1')])).resolves.toEqual([undefined, true, undefined]);
  });

  it('keeps a delete as its hash only', async () => {
    const requests = createPrismaInstallationRequests(prisma);
    await requests.record({ requestId: 'd-1', kind: 'deleteFleet', requestHash: 'h', fleetId: null, isEnabled: null, at: AT });

    await expect(requests.find('d-1')).resolves.toEqual({ requestId: 'd-1', kind: 'deleteFleet', requestHash: 'h', fleetId: null, isEnabled: null, at: AT });
  });
});
