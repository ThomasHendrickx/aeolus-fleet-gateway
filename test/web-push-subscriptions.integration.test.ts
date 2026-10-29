import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaWebPushSubscriptions } from '../src/adapters/prisma/web-push-subscriptions.js';
import { aWebPushSubscription } from './support/people-fakes.js';
import { migratedDatabase } from './support/database.js';

// The browsers a person turned web push on in, in Postgres, by fleet, person
// ship and endpoint (wake a person, W8).

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

describe('the browsers a person turned web push on in, in Postgres (W8)', () => {
  it('keeps each by its endpoint, oldest added first, in its fleet and person ship only', async () => {
    const subscriptions = createPrismaWebPushSubscriptions(prisma);
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8w1';
    const firefox = aWebPushSubscription({ fleetId: FLEET, shipId, endpoint: 'https://push.example/firefox', addedAt: AT });
    const chrome = aWebPushSubscription({ fleetId: FLEET, shipId, endpoint: 'https://push.example/chrome', browser: 'Chrome on macOS', addedAt: new Date(AT.getTime() + 1000) });
    await subscriptions.save(chrome);
    await subscriptions.save(firefox);
    await subscriptions.save(aWebPushSubscription({ fleetId: OTHER_FLEET, shipId, endpoint: 'https://push.example/other' }));
    await subscriptions.save(aWebPushSubscription({ fleetId: FLEET, shipId: 'shp_01m3tb1zgr5h2ffee12xnch8w2', endpoint: 'https://push.example/someone-else' }));

    await expect(subscriptions.list(FLEET, shipId)).resolves.toEqual([firefox, chrome]);
  });

  it('keeps a browser turned on again anew, by its endpoint', async () => {
    const subscriptions = createPrismaWebPushSubscriptions(prisma);
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8w3';
    await subscriptions.save(aWebPushSubscription({ fleetId: FLEET, shipId, goneAt: AT }));
    const again = aWebPushSubscription({ fleetId: FLEET, shipId, keys: { p256dh: 'BNewKey', auth: 'NewAuth' }, addedAt: new Date(AT.getTime() + 1000) });

    await subscriptions.save(again);

    await expect(subscriptions.list(FLEET, shipId)).resolves.toEqual([again]);
  });

  it('marks one gone, and removes one, in its fleet only', async () => {
    const subscriptions = createPrismaWebPushSubscriptions(prisma);
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8w4';
    const gone = aWebPushSubscription({ fleetId: FLEET, shipId, endpoint: 'https://push.example/gone' });
    const removed = aWebPushSubscription({ fleetId: FLEET, shipId, endpoint: 'https://push.example/removed' });
    const elsewhere = aWebPushSubscription({ fleetId: OTHER_FLEET, shipId, endpoint: 'https://push.example/removed' });
    await Promise.all([subscriptions.save(gone), subscriptions.save(removed), subscriptions.save(elsewhere)]);

    await subscriptions.markGone(FLEET, { shipId, endpoint: gone.endpoint, goneAt: AT });
    await subscriptions.remove(FLEET, { shipId, endpoint: removed.endpoint });

    await expect(Promise.all([subscriptions.list(FLEET, shipId), subscriptions.list(OTHER_FLEET, shipId)])).resolves.toEqual([[{ ...gone, goneAt: AT }], [elsewhere]]);
  });

  it('is forgotten with its fleet (decision 0021)', async () => {
    const subscriptions = createPrismaWebPushSubscriptions(prisma);
    const fleetId: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch9fh';
    const shipId: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8w5';
    await subscriptions.save(aWebPushSubscription({ fleetId, shipId }));

    await createPrismaFleetForgetter(prisma).forget(fleetId);

    await expect(subscriptions.list(fleetId, shipId)).resolves.toEqual([]);
  });
});
