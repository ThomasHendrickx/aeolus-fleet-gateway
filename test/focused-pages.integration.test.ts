import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaFocusedPages } from '../src/adapters/prisma/focused-pages.js';
import { migratedDatabase } from './support/database.js';

// A person's pages in focus, in Postgres, so the waiter of their person ship
// sees them from whichever gateway instance it runs on (wake a person, W6).

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

describe("a person's pages in focus, in Postgres (W6)", () => {
  it('counts a page seen in focus since then, of that person ship and fleet only', async () => {
    const focused = createPrismaFocusedPages(prisma);
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8f1';
    await focused.save({ fleetId: FLEET, shipId, pageId: 'page-1', seenAt: AT });

    await expect(
      Promise.all([
        focused.isAnyInFocus({ fleetId: FLEET, shipId }, AT),
        focused.isAnyInFocus({ fleetId: FLEET, shipId }, new Date(AT.getTime() + 1)),
        focused.isAnyInFocus({ fleetId: OTHER_FLEET, shipId }, AT),
        focused.isAnyInFocus({ fleetId: FLEET, shipId: 'shp_01m3tb1zgr5h2ffee12xnch8f2' }, AT),
      ]),
    ).resolves.toEqual([true, false, false, false]);
  });

  it('keeps when a page was seen anew, and forgets it once it lost focus', async () => {
    const focused = createPrismaFocusedPages(prisma);
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8f3';
    const later = new Date(AT.getTime() + 20_000);
    await focused.save({ fleetId: FLEET, shipId, pageId: 'page-3', seenAt: AT });
    await focused.save({ fleetId: FLEET, shipId, pageId: 'page-3', seenAt: later });
    const isSeenLater = await focused.isAnyInFocus({ fleetId: FLEET, shipId }, later);

    await focused.remove(FLEET, 'page-3');

    expect({ isSeenLater, isInFocus: await focused.isAnyInFocus({ fleetId: FLEET, shipId }, AT) }).toEqual({ isSeenLater: true, isInFocus: false });
  });

  it('is forgotten with its fleet (decision 0021)', async () => {
    const focused = createPrismaFocusedPages(prisma);
    const fleetId: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch9fg';
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8f4';
    await focused.save({ fleetId, shipId, pageId: 'page-4', seenAt: AT });

    await createPrismaFleetForgetter(prisma).forget(fleetId);

    await expect(focused.isAnyInFocus({ fleetId, shipId }, AT)).resolves.toBe(false);
  });
});
