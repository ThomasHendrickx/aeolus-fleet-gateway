import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaRoutes } from '../src/adapters/prisma/routes.js';
import type { Route } from '../src/core/people/routing.js';
import { migratedDatabase } from './support/database.js';

// Routing per job in Postgres (Bridge, section 8): each person's own choice
// of where a job shows, by fleet, person ship, job and place.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const AT = new Date('2026-11-01T09:00:00.000Z');
const LATER = new Date('2026-11-01T10:00:00.000Z');

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

function aRoute(shipId: ShipId, overrides: Partial<Route> = {}): Route {
  return { fleetId: FLEET, shipId, job: 'decide', place: 'slack', isOn: true, changedAt: AT, ...overrides };
}

describe("a person's routes in Postgres", () => {
  it('holds none until the person chooses', async () => {
    await expect(createPrismaRoutes(prisma).list({ fleetId: FLEET, shipId: 'shp_01m3tb1zgr5h2ffee12xnch8r1' })).resolves.toEqual([]);
  });

  it('keeps each job and place of the person ship, in its fleet only', async () => {
    const routes = createPrismaRoutes(prisma);
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8r2';
    await routes.save(aRoute(shipId));
    await routes.save(aRoute(shipId, { job: 'stay-aware', place: 'chat', isOn: false }));
    await routes.save(aRoute(shipId, { fleetId: OTHER_FLEET, place: 'email' }));

    const listed = await routes.list({ fleetId: FLEET, shipId });

    expect(listed.sort((a, b) => a.job.localeCompare(b.job))).toEqual([aRoute(shipId), aRoute(shipId, { job: 'stay-aware', place: 'chat', isOn: false })]);
  });

  it('keeps a job and place anew when turned again', async () => {
    const routes = createPrismaRoutes(prisma);
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8r3';
    await routes.save(aRoute(shipId));

    await routes.save(aRoute(shipId, { isOn: false, changedAt: LATER }));

    await expect(routes.list({ fleetId: FLEET, shipId })).resolves.toEqual([aRoute(shipId, { isOn: false, changedAt: LATER })]);
  });

  it('is forgotten with its fleet (decision 0021)', async () => {
    const routes = createPrismaRoutes(prisma);
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8r4';
    await routes.save(aRoute(shipId, { fleetId: OTHER_FLEET }));

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    await expect(routes.list({ fleetId: OTHER_FLEET, shipId })).resolves.toEqual([]);
  });
});
