import type { FleetId, ShipId } from '@aeolus-fleet/common';
import webPush from 'web-push';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaPersonCrews } from '../src/adapters/prisma/person-crews.js';
import { createPrismaWakesSent } from '../src/adapters/prisma/wakes-sent.js';
import { createPrismaWebPushSubscriptions } from '../src/adapters/prisma/web-push-subscriptions.js';
import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { commission, register, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { charlotteIn, PAGASAE_APP_CLIENT, PAGASAE_CLIENT, startFakePagasae, type FakePagasae } from './support/fake-pagasae.js';
import { aFreePort, startFleetServer, type FleetServer } from './support/fleet-server.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';
import { aWebPushSubscription } from './support/people-fakes.js';
import { startPushService } from './support/push-service.js';

// A person who turned web push on is woken when a delivery reaches their
// person ship, unless a page of theirs is in focus (wake a person, W3, W4,
// W6): the gateway's waiter sends the wake and reports the delivery handed,
// naming the channel. The fleet, the gateway and the push service are real
// servers; pagasae is a fake.

const SIGN_IN = 'charlotte-shared-sign-in';
const WOKEN_WITHIN_MS = 20_000;
/** Web push's window in these tests: short, so a test sees it end. */
const WINDOW_MS = 4_000;

let fleet: FleetServer;
let pagasae: FakePagasae;
let pushService: Awaited<ReturnType<typeof startPushService>>;
let app: GatewayApp;
let prisma: PrismaClient;
let address: string;
let fleetId: FleetId;
let charlotte: { shipId: ShipId; crewToken: string };
let tracker: string;
/** The path of Charlotte's browser at the push service. */
const FIREFOX = '/firefox';

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  const cookie = await signIn(fleet);
  const charlotteCrew = await register(fleet, await commission(fleet, { cookie, ship: { name: 'charlotte', type: 'person', kind: 'person' } }));
  tracker = await register(fleet, await commission(fleet, { cookie, ship: { name: 'tracker', type: 'issue-tracker', kind: 'app' } }));
  const who = await createRestFleetDoor(fleet.url).whoami(charlotteCrew);
  if (!who.isOk) {
    throw new Error('charlotte is not crewed');
  }
  fleetId = who.value.fleetId;
  charlotte = { shipId: who.value.shipId, crewToken: charlotteCrew };
  const databaseUrl = await migratedDatabase(inject('postgresUrl'));
  prisma = createPrismaClient(databaseUrl);
  // The gateway crewed Charlotte's person ship at an earlier sign-in, and they turned web push on in one browser.
  await createPrismaPersonCrews(prisma).save({ fleetId, shipId: charlotte.shipId, crewToken: charlotteCrew, crewedAt: new Date() });
  pushService = await startPushService();
  const browser = pushService.browser(FIREFOX);
  await createPrismaWebPushSubscriptions(prisma).save(aWebPushSubscription({ fleetId, shipId: charlotte.shipId, endpoint: browser.endpoint, keys: browser.keys, fleetName: 'Acme' }));
  pagasae = await startFakePagasae();
  pagasae.sharedSignIn(SIGN_IN, { ...charlotteIn(pagasae, fleetId), person_ship: charlotte.shipId });
  const port = await aFreePort();
  address = `http://127.0.0.1:${String(port)}`;
  const keys = webPush.generateVAPIDKeys();
  app = createGatewayApp({
    databaseUrl,
    fleetUrl: fleet.url,
    logger: false,
    publicUrl: address,
    gatewaySecret: TEST_GATEWAY_SECRET,
    pagasae: { url: pagasae.url, ...PAGASAE_CLIENT },
    pagasaeApp: PAGASAE_APP_CLIENT,
    webPush: { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: 'mailto:ops@example.com' },
    webPushWakeWindowMs: WINDOW_MS,
  });
  await app.server.listen({ host: '127.0.0.1', port });
  await app.restoreConnections();
});

afterEach(async () => {
  await app.close();
  await prisma.$disconnect();
  await pushService.stop();
  await pagasae.stop();
  await fleet.stop();
});

async function trackerSendsCharlotte(): Promise<void> {
  const sent = await fetch(`${fleet.url}/api/v1/ship/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tracker}` },
    body: JSON.stringify({ selector: { kind: 'ship', name: 'charlotte' }, contentType: 'text/plain', payload: 'Issue 7 is closed', idempotencyKey: crypto.randomUUID() }),
  });
  expect(sent.status).toBe(200);
}

/** Each hand-over the person ship's crew reported, by its channel, as core keeps it. */
async function handOvers(): Promise<{ handOverNumber: unknown; channel: unknown }[]> {
  const core = createPrismaClient(fleet.databaseUrl);
  try {
    const rows = await core.$queryRaw<{ details: Record<string, unknown> }[]>`SELECT e."details" FROM "events" e JOIN "ships" s ON s."id" = e."ship_id" AND s."fleet_id" = e."fleet_id" WHERE e."type" = 'DeliveryHanded' AND s."name" = 'charlotte'`;
    return rows.map(({ details }) => ({ handOverNumber: details.handOverNumber, channel: details.channel }));
  } finally {
    await core.$disconnect();
  }
}

/** Charlotte's page in focus: the stream it holds open while so. */
async function charlottesPageInFocus() {
  const stop = new AbortController();
  const stream = await fetch(`${address}/trpc/people.focus`, { headers: { accept: 'text/event-stream', cookie: `aeolus_account_session=${SIGN_IN}`, 'aeolus-fleet': fleetId }, signal: stop.signal });
  if (stream.body === null) {
    throw new Error('The stream has no body');
  }
  const reader = stream.body.pipeThrough(new TextDecoderStream()).getReader();
  // In focus once it says it holds.
  let heard = '';
  while (!heard.includes('isInFocus')) {
    const { value, done } = await reader.read();
    if (done) {
      throw new Error(`The focus stream ended: ${heard}`);
    }
    heard += value;
  }
  return {
    close: () => {
      stop.abort();
    },
  };
}

describe('a person who turned web push on, as a delivery reaches their person ship', () => {
  it('is woken in their browser: the fleet by its name and the overview link, nothing else', async () => {
    await trackerSendsCharlotte();

    await expect.poll(() => pushService.taken.map(({ text }) => text), { timeout: WOKEN_WITHIN_MS }).toEqual([
      JSON.stringify({ fleetName: 'Acme', overviewUrl: `${address}/overview?fleet=${fleetId}` }),
    ]);
  });

  it('has the delivery reported handed, number 1, through web push', async () => {
    await trackerSendsCharlotte();

    await expect.poll(handOvers, { timeout: WOKEN_WITHIN_MS }).toEqual([{ handOverNumber: 1, channel: 'web-push' }]);
  });

  it('is not woken while a page of theirs is in focus, and the delivery is handed through the page', async () => {
    const page = await charlottesPageInFocus();

    try {
      await trackerSendsCharlotte();

      await expect.poll(handOvers, { timeout: WOKEN_WITHIN_MS }).toEqual([{ handOverNumber: 1, channel: 'page' }]);
      expect(pushService.taken).toEqual([]);
    } finally {
      page.close();
    }
  });

  it('gives ten deliveries that arrive inside the window one wake once it ends, and ten hand-overs', async () => {
    // Web push woke Charlotte a moment ago: its window is open.
    await createPrismaWakesSent(prisma).record({ ship: { fleetId, shipId: charlotte.shipId }, channel: 'web-push', sentAt: new Date() });

    for (let sent = 0; sent < 10; sent += 1) {
      await trackerSendsCharlotte();
    }

    await expect.poll(async () => (await handOvers()).length, { timeout: WOKEN_WITHIN_MS + WINDOW_MS }).toBe(10);
    expect({ wakes: pushService.taken.length, channels: new Set((await handOvers()).map(({ channel }) => channel)) }).toEqual({ wakes: 1, channels: new Set(['web-push']) });
  });

  it('forgets a browser whose push service says its subscription is gone, handing nothing', async () => {
    pushService.statuses.set(FIREFOX, [410]);

    await trackerSendsCharlotte();

    await expect.poll(async () => (await createPrismaWebPushSubscriptions(prisma).list(fleetId, charlotte.shipId)).map(({ goneAt }) => goneAt !== null), { timeout: WOKEN_WITHIN_MS }).toEqual([true]);
    expect(await handOvers()).toEqual([]);
  });
});
