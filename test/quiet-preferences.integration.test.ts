import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaQuietHours, createPrismaQuietShips } from '../src/adapters/prisma/quiet-preferences.js';
import type { QuietHours } from '../src/core/people/quiet-hours.js';
import type { QuietShip } from '../src/core/people/quiet-ships.js';
import { migratedDatabase } from './support/database.js';

// Quiet hours and quiet ships in Postgres (preferences design): per fleet and
// person ship, beside their routing.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const AT = new Date('2026-11-01T09:00:00.000Z');
const LATER = new Date('2026-11-01T10:00:00.000Z');
const PAGE_SIZE = 20;

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

function someQuietHours(shipId: ShipId, overrides: Partial<QuietHours> = {}): QuietHours {
  return { fleetId: FLEET, shipId, isOn: true, fromMinute: 22 * 60, toMinute: 7 * 60, timeZone: 'Europe/Brussels', changedAt: AT, ...overrides };
}

/** The quiet ship of the index, its id ending in the index. */
function quietShipIdOf(index: number): ShipId {
  return `shp_01m3tb1zgr5h2ffee12xnc${String(index).padStart(4, '0')}`;
}

function aQuietShip(shipId: ShipId, overrides: Partial<QuietShip> = {}): QuietShip {
  return { fleetId: FLEET, shipId, quietShipId: quietShipIdOf(1), name: 'watcher', isQuiet: true, changedAt: AT, ...overrides };
}

describe("a person's quiet hours in Postgres", () => {
  it('holds none until the person sets them', async () => {
    await expect(createPrismaQuietHours(prisma).find({ fleetId: FLEET, shipId: 'shp_01m3tb1zgr5h2ffee12xnch9q1' })).resolves.toBeUndefined();
  });

  it('keeps them for the person ship, in its fleet only', async () => {
    const quietHours = createPrismaQuietHours(prisma);
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch9q2';
    await quietHours.save(someQuietHours(shipId));
    await quietHours.save(someQuietHours(shipId, { fleetId: OTHER_FLEET, isOn: false }));

    await expect(quietHours.find({ fleetId: FLEET, shipId })).resolves.toEqual(someQuietHours(shipId));
  });

  it('keeps them anew when set again', async () => {
    const quietHours = createPrismaQuietHours(prisma);
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch9q3';
    await quietHours.save(someQuietHours(shipId));

    await quietHours.save(someQuietHours(shipId, { isOn: false, fromMinute: 0, toMinute: 1439, timeZone: 'UTC', changedAt: LATER }));

    await expect(quietHours.find({ fleetId: FLEET, shipId })).resolves.toEqual(someQuietHours(shipId, { isOn: false, fromMinute: 0, toMinute: 1439, timeZone: 'UTC', changedAt: LATER }));
  });
});

describe("a person's quiet ships in Postgres", () => {
  it('answers what the person chose among the ships asked, quiet or woken again, in its fleet only', async () => {
    const quietShips = createPrismaQuietShips(prisma);
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch9s1';
    await quietShips.save(aQuietShip(shipId));
    await quietShips.save(aQuietShip(shipId, { quietShipId: quietShipIdOf(2), isQuiet: false }));
    await quietShips.save(aQuietShip(shipId, { quietShipId: quietShipIdOf(3) }));
    await quietShips.save(aQuietShip(shipId, { fleetId: OTHER_FLEET, quietShipId: quietShipIdOf(4) }));

    const among = await quietShips.among({ fleetId: FLEET, shipId }, [quietShipIdOf(1), quietShipIdOf(2), quietShipIdOf(4), quietShipIdOf(5)]);

    expect(among.sort((a, b) => a.quietShipId.localeCompare(b.quietShipId))).toEqual([aQuietShip(shipId), aQuietShip(shipId, { quietShipId: quietShipIdOf(2), isQuiet: false })]);
  });

  it('answers nothing among no ships', async () => {
    await expect(createPrismaQuietShips(prisma).among({ fleetId: FLEET, shipId: 'shp_01m3tb1zgr5h2ffee12xnch9s1' }, [])).resolves.toEqual([]);
  });

  it('keeps a ship anew when woken again', async () => {
    const quietShips = createPrismaQuietShips(prisma);
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch9s2';
    await quietShips.save(aQuietShip(shipId));

    await quietShips.save(aQuietShip(shipId, { isQuiet: false, changedAt: LATER }));

    await expect(quietShips.among({ fleetId: FLEET, shipId }, [quietShipIdOf(1)])).resolves.toEqual([aQuietShip(shipId, { isQuiet: false, changedAt: LATER })]);
  });

  it('lists the quiet ones only, the latest quieted first, a page at a time', async () => {
    const quietShips = createPrismaQuietShips(prisma);
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch9s3';
    // 21 quiet, each a minute after the one before, and one woken again.
    for (let index = 1; index <= PAGE_SIZE + 1; index += 1) {
      await quietShips.save(aQuietShip(shipId, { quietShipId: quietShipIdOf(index), changedAt: new Date(AT.getTime() + index * 60_000) }));
    }
    await quietShips.save(aQuietShip(shipId, { quietShipId: quietShipIdOf(99), isQuiet: false, changedAt: LATER }));

    const first = await quietShips.listQuiet({ fleetId: FLEET, shipId }, { cursor: null, limit: PAGE_SIZE });
    const second = await quietShips.listQuiet({ fleetId: FLEET, shipId }, { cursor: first.nextCursor, limit: PAGE_SIZE });

    expect({ first: first.ships.map(({ quietShipId }) => quietShipId.slice(-4)), cursor: first.nextCursor, second: second.ships.map(({ quietShipId }) => quietShipId.slice(-4)), last: second.nextCursor }).toEqual({
      first: Array.from({ length: PAGE_SIZE }, (_, index) => String(PAGE_SIZE + 1 - index).padStart(4, '0')),
      cursor: quietShipIdOf(2),
      second: ['0001'],
      last: null,
    });
  });

  it('lists ships quieted at the same moment one after the other, none twice', async () => {
    const quietShips = createPrismaQuietShips(prisma);
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch9s4';
    for (const index of [1, 2, 3]) {
      await quietShips.save(aQuietShip(shipId, { quietShipId: quietShipIdOf(index) }));
    }

    const first = await quietShips.listQuiet({ fleetId: FLEET, shipId }, { cursor: null, limit: 2 });
    const second = await quietShips.listQuiet({ fleetId: FLEET, shipId }, { cursor: first.nextCursor, limit: 2 });

    expect([...first.ships, ...second.ships].map(({ quietShipId }) => quietShipId.slice(-4)).sort()).toEqual(['0001', '0002', '0003']);
  });
});

describe('quiet preferences and their fleet', () => {
  it('are forgotten with their fleet (decision 0021)', async () => {
    const quietHours = createPrismaQuietHours(prisma);
    const quietShips = createPrismaQuietShips(prisma);
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch9f1';
    await quietHours.save(someQuietHours(shipId, { fleetId: OTHER_FLEET }));
    await quietShips.save(aQuietShip(shipId, { fleetId: OTHER_FLEET }));

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    expect({ hours: await quietHours.find({ fleetId: OTHER_FLEET, shipId }), ships: await quietShips.among({ fleetId: OTHER_FLEET, shipId }, [quietShipIdOf(1)]) }).toEqual({ hours: undefined, ships: [] });
  });
});
