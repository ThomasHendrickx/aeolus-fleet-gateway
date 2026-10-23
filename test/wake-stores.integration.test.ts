import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaFocusedPages, createPrismaPersonWakes, createPrismaWebPushSubscriptions } from '../src/adapters/prisma/wake-stores.js';
import { aWebPushSubscription } from './support/people-fakes.js';
import { migratedDatabase } from './support/database.js';

// What the gateway keeps to wake a person (wake a person, W3, W6, W8): the
// browsers they turned web push on in, when each channel last woke them, and
// their pages in focus, each by fleet and person ship.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const AT = new Date('2026-10-23T09:00:00.000Z');

let prisma: PrismaClient;
let shipNumber = 0;

/** A person ship of its own for each test, so tests share no rows. */
function aPersonShip(): ShipId {
  shipNumber += 1;
  return `shp_01m3tb1zgr5h2ffee12xnch${String(shipNumber).padStart(3, '0')}`;
}

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('the browsers a person turned web push on in, in Postgres (W8)', () => {
  it('keeps each by its endpoint, oldest added first, in its fleet and person ship only', async () => {
    const subscriptions = createPrismaWebPushSubscriptions(prisma);
    const shipId = aPersonShip();
    const firefox = aWebPushSubscription({ fleetId: FLEET, shipId, endpoint: 'https://push.example/firefox', addedAt: AT });
    const chrome = aWebPushSubscription({ fleetId: FLEET, shipId, endpoint: 'https://push.example/chrome', browser: 'Chrome on macOS', addedAt: new Date(AT.getTime() + 1000) });
    await subscriptions.save(chrome);
    await subscriptions.save(firefox);
    await subscriptions.save(aWebPushSubscription({ fleetId: OTHER_FLEET, shipId, endpoint: 'https://push.example/other' }));
    await subscriptions.save(aWebPushSubscription({ fleetId: FLEET, shipId: aPersonShip(), endpoint: 'https://push.example/someone-else' }));

    await expect(subscriptions.list(FLEET, shipId)).resolves.toEqual([firefox, chrome]);
  });

  it('keeps a browser turned on again anew, by its endpoint', async () => {
    const subscriptions = createPrismaWebPushSubscriptions(prisma);
    const shipId = aPersonShip();
    await subscriptions.save(aWebPushSubscription({ fleetId: FLEET, shipId, goneAt: AT }));
    const again = aWebPushSubscription({ fleetId: FLEET, shipId, keys: { p256dh: 'BNewKey', auth: 'NewAuth' }, addedAt: new Date(AT.getTime() + 1000) });

    await subscriptions.save(again);

    await expect(subscriptions.list(FLEET, shipId)).resolves.toEqual([again]);
  });

  it('marks one gone, and removes one, in its fleet only', async () => {
    const subscriptions = createPrismaWebPushSubscriptions(prisma);
    const shipId = aPersonShip();
    const gone = aWebPushSubscription({ fleetId: FLEET, shipId, endpoint: 'https://push.example/gone' });
    const removed = aWebPushSubscription({ fleetId: FLEET, shipId, endpoint: 'https://push.example/removed' });
    const elsewhere = aWebPushSubscription({ fleetId: OTHER_FLEET, shipId, endpoint: 'https://push.example/removed' });
    await Promise.all([subscriptions.save(gone), subscriptions.save(removed), subscriptions.save(elsewhere)]);

    await subscriptions.markGone(FLEET, { shipId, endpoint: gone.endpoint, goneAt: AT });
    await subscriptions.remove(FLEET, { shipId, endpoint: removed.endpoint });

    await expect(Promise.all([subscriptions.list(FLEET, shipId), subscriptions.list(OTHER_FLEET, shipId)])).resolves.toEqual([[{ ...gone, goneAt: AT }], [elsewhere]]);
  });
});

describe('when each channel last woke a person ship, in Postgres (W3, W10)', () => {
  it('keeps the last wake of each channel, in its fleet only', async () => {
    const wakes = createPrismaPersonWakes(prisma);
    const shipId = aPersonShip();
    await wakes.record({ fleetId: FLEET, shipId }, { channel: 'web-push', at: AT });
    const later = new Date(AT.getTime() + 600_000);

    await wakes.record({ fleetId: FLEET, shipId }, { channel: 'web-push', at: later });

    await expect(
      Promise.all([wakes.lastWokenAt({ fleetId: FLEET, shipId }, 'web-push'), wakes.lastWokenAt({ fleetId: FLEET, shipId }, 'page'), wakes.lastWokenAt({ fleetId: OTHER_FLEET, shipId }, 'web-push')]),
    ).resolves.toEqual([later, undefined, undefined]);
  });
});

describe("a person's pages in focus, in Postgres (W6)", () => {
  it('counts a page seen in focus since then, of that person ship and fleet only', async () => {
    const focused = createPrismaFocusedPages(prisma);
    const shipId = aPersonShip();
    await focused.save({ fleetId: FLEET, shipId, pageId: `page-${shipId}`, seenAt: AT });

    await expect(
      Promise.all([
        focused.isAnyInFocus({ fleetId: FLEET, shipId }, AT),
        focused.isAnyInFocus({ fleetId: FLEET, shipId }, new Date(AT.getTime() + 1)),
        focused.isAnyInFocus({ fleetId: OTHER_FLEET, shipId }, AT),
        focused.isAnyInFocus({ fleetId: FLEET, shipId: aPersonShip() }, AT),
      ]),
    ).resolves.toEqual([true, false, false, false]);
  });

  it('keeps when a page was seen anew, and forgets it once it lost focus', async () => {
    const focused = createPrismaFocusedPages(prisma);
    const shipId = aPersonShip();
    const later = new Date(AT.getTime() + 20_000);
    await focused.save({ fleetId: FLEET, shipId, pageId: `page-${shipId}`, seenAt: AT });
    await focused.save({ fleetId: FLEET, shipId, pageId: `page-${shipId}`, seenAt: later });
    const isSeenLater = await focused.isAnyInFocus({ fleetId: FLEET, shipId }, later);

    await focused.remove(FLEET, `page-${shipId}`);

    expect({ isSeenLater, isInFocus: await focused.isAnyInFocus({ fleetId: FLEET, shipId }, AT) }).toEqual({ isSeenLater: true, isInFocus: false });
  });
});

it("forgets a fleet with its people's web push, wakes and pages in focus (decision 0021)", async () => {
  const subscriptions = createPrismaWebPushSubscriptions(prisma);
  const wakes = createPrismaPersonWakes(prisma);
  const focused = createPrismaFocusedPages(prisma);
  const fleetId: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch9fg';
  const shipId = aPersonShip();
  await subscriptions.save(aWebPushSubscription({ fleetId, shipId }));
  await wakes.record({ fleetId, shipId }, { channel: 'web-push', at: AT });
  await focused.save({ fleetId, shipId, pageId: 'page-forgotten', seenAt: AT });

  await createPrismaFleetForgetter(prisma).forget(fleetId);

  await expect(Promise.all([subscriptions.list(fleetId, shipId), wakes.lastWokenAt({ fleetId, shipId }, 'web-push'), focused.isAnyInFocus({ fleetId, shipId }, AT)])).resolves.toEqual([[], undefined, false]);
});
