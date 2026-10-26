import { createServer, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';
import type { FleetId, ShipId } from '@aeolus-fleet/common';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { createPrismaFocusedPages } from '../src/adapters/prisma/focused-pages.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaPersonCrews } from '../src/adapters/prisma/person-crews.js';
import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { commission, register, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { charlotteIn, PAGASAE_APP_CLIENT, PAGASAE_CLIENT, startFakePagasae, WAKE_INSTALLATION_TOKEN, type FakePagasae } from './support/fake-pagasae.js';
import { aFreePort, startFleetServer, type FleetServer } from './support/fleet-server.js';
import { mutate } from './support/gateway-api.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';

// A person who turned email on is woken by email when something waits for
// their person ship (wake a person, S4: W2, W3, W8): pagasae sends it, at
// most once per window, and each delivery it covers is handed no. 1 through
// email. The fleet and the gateway are real; pagasae is a fake.

const SIGN_IN = 'charlotte-shared-sign-in';
const WINDOW_MS = 8_000;
const SEEN_WITHIN_MS = 20_000;
/** The first wait before a wake that failed is tried again (the gateway's own). */
const FAILED_WAKE_AGAIN_MS = 60_000;

/** The fleet as the gateway reaches it: every call passes through, except the answer of a push receive that can be told to get lost. */
interface LossyFleet {
  url: string;
  /** Lets the next push receive that took a delivery reach the fleet, but loses its answer. */
  loseNextTakenAnswer(): void;
  /** How many push-receive answers were lost. */
  readonly lost: number;
  stop(): Promise<void>;
}

async function lossyFleetIn(target: string): Promise<LossyFleet> {
  let isLosing = false;
  let lost = 0;
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
      const forwarded = fetch(`${target}${request.url ?? ''}`, {
        method: request.method ?? 'GET',
        headers: Object.fromEntries(Object.entries(request.headers).flatMap(([name, value]) => (typeof value === 'string' && name !== 'host' && name !== 'content-length' ? [[name, value]] : []))),
        ...(hasBody ? { body: Buffer.concat(chunks) } : {}),
      });
      forwarded
        .then(async (answered) => {
          const body = Buffer.from(await answered.arrayBuffer());
          if (isLosing && request.url === '/api/v1/ship/pushReceive' && (z.object({ deliveries: z.array(z.unknown()) }).safeParse(JSON.parse(body.toString())).data?.deliveries.length ?? 0) > 0) {
            isLosing = false;
            lost += 1;
            request.socket.destroy();
            return;
          }
          response.writeHead(answered.status, { 'content-type': answered.headers.get('content-type') ?? 'application/json' });
          response.end(body);
        })
        .catch(() => request.socket.destroy());
    });
  });
  const port = await aFreePort();
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${String(port)}`,
    loseNextTakenAnswer: () => {
      isLosing = true;
    },
    get lost() {
      return lost;
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => { resolve(); });
      }),
  };
}

let fleet: FleetServer;
let lossy: LossyFleet;
let pagasae: FakePagasae;
let app: GatewayApp;
let prisma: PrismaClient;
let address: string;
let argo: string;
let fleetId: FleetId;
let charlotteShipId: ShipId;
let tracker: string;

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  argo = await signIn(fleet);
  const charlotteCrew = await register(fleet, await commission(fleet, { cookie: argo, ship: { name: 'charlotte', type: 'person', kind: 'person' } }));
  tracker = await register(fleet, await commission(fleet, { cookie: argo, ship: { name: 'tracker', type: 'issue-tracker', kind: 'app' } }));
  const who = await createRestFleetDoor(fleet.url).whoami(charlotteCrew);
  if (!who.isOk) {
    throw new Error('charlotte is not crewed');
  }
  lossy = await lossyFleetIn(fleet.url);
  fleetId = who.value.fleetId;
  charlotteShipId = who.value.shipId;
  const databaseUrl = await migratedDatabase(inject('postgresUrl'));
  prisma = createPrismaClient(databaseUrl);
  // The gateway crewed Charlotte's person ship at an earlier sign-in.
  await createPrismaPersonCrews(prisma).save({ fleetId: who.value.fleetId, shipId: who.value.shipId, crewToken: charlotteCrew, crewedAt: new Date() });
  pagasae = await startFakePagasae();
  pagasae.sharedSignIn(SIGN_IN, { ...charlotteIn(pagasae, fleetId), person_ship: who.value.shipId });
  const port = await aFreePort();
  address = `http://127.0.0.1:${String(port)}`;
  app = createGatewayApp({
    databaseUrl,
    fleetUrl: lossy.url,
    logger: false,
    publicUrl: address,
    gatewaySecret: TEST_GATEWAY_SECRET,
    installationToken: WAKE_INSTALLATION_TOKEN,
    pagasae: { url: pagasae.url, ...PAGASAE_CLIENT },
    pagasaeApp: PAGASAE_APP_CLIENT,
    emailWakeWindowMs: WINDOW_MS,
  });
  await app.server.listen({ host: '127.0.0.1', port });
  expect((await mutate(address, { procedure: 'installation.setEnabled', installationToken: WAKE_INSTALLATION_TOKEN, body: { requestId: 'switch-on', fleetId, enabled: true } })).status).toBe(200);
  await app.restoreConnections();
});

afterEach(async () => {
  await app.close();
  await prisma.$disconnect();
  await pagasae.stop();
  await lossy.stop();
  await fleet.stop();
});

const asCharlotte = (): Record<string, string> => ({ cookie: `aeolus_account_session=${SIGN_IN}`, 'aeolus-fleet': fleetId });

async function turnEmail(isOn: boolean): Promise<void> {
  const turned = await fetch(`${address}/trpc/people.turnEmail`, { method: 'POST', headers: { 'content-type': 'application/json', ...asCharlotte() }, body: JSON.stringify({ isOn }) });
  expect(turned.status).toBe(200);
}

/** The tracker sends Charlotte a message: its id. */
async function trackerSendsCharlotte(): Promise<string> {
  const sent = await fetch(`${fleet.url}/api/v1/ship/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tracker}` },
    body: JSON.stringify({ selector: { kind: 'ship', name: 'charlotte' }, contentType: 'text/plain', payload: 'Issue 7 is closed', idempotencyKey: crypto.randomUUID() }),
  });
  expect(sent.status).toBe(200);
  return z.object({ messageId: z.string() }).parse(await sent.json()).messageId;
}

const historySchema = z.object({ result: z.object({ data: z.object({ delivery: z.object({ history: z.array(z.object({ type: z.string(), channel: z.string().nullable().optional() })) }) }) }) });

/** The way the message's delivery went, as argo reads it in the console: each step's type, and the channel a hand-over named. */
async function historyOf(messageId: string): Promise<{ type: string; channel?: string | null | undefined }[]> {
  const read = await fetch(`${fleet.url}/trpc/fleet.message?input=${encodeURIComponent(JSON.stringify({ messageId }))}`, { headers: { cookie: argo, origin: fleet.url } });
  return historySchema.parse(await read.json()).result.data.delivery.history;
}

async function handOvers(messageId: string): Promise<(string | null | undefined)[]> {
  return (await historyOf(messageId)).filter(({ type }) => type === 'DeliveryHanded').map(({ channel }) => channel);
}

describe('a person woken by email (wake a person, S4)', () => {
  it('gets no email while they have not turned email on, and nothing is handed', async () => {
    const messageId = await trackerSendsCharlotte();

    // The waiter took the delivery for the person, with the gateway as its waker, and found no channel on.
    await expect.poll(async () => (await historyOf(messageId)).some(({ type }) => type === 'DeliveryReceived'), { timeout: SEEN_WITHIN_MS }).toBe(true);

    expect({ wakes: pagasae.wakes, handOvers: await handOvers(messageId) }).toEqual({ wakes: [], handOvers: [] });
  });

  it('gets an email once they turned email on, naming their person ship, and the delivery is handed no. 1 through email', async () => {
    await turnEmail(true);

    const messageId = await trackerSendsCharlotte();

    await expect.poll(async () => handOvers(messageId), { timeout: SEEN_WITHIN_MS }).toEqual(['email']);
    expect(pagasae.wakes).toEqual([{ fleetId, shipId: charlotteShipId }]);
  });

  it('gets one email per window: what arrives inside it waits for the next, and is handed then', async () => {
    await turnEmail(true);
    const first = await trackerSendsCharlotte();
    await expect.poll(async () => handOvers(first), { timeout: SEEN_WITHIN_MS }).toEqual(['email']);

    const second = await trackerSendsCharlotte();
    await expect.poll(async () => (await historyOf(second)).some(({ type }) => type === 'DeliveryReceived'), { timeout: SEEN_WITHIN_MS }).toBe(true);
    const insideTheWindow = { wakes: pagasae.wakes.length, handOvers: await handOvers(second) };

    await expect.poll(async () => handOvers(second), { timeout: SEEN_WITHIN_MS + WINDOW_MS }).toEqual(['email']);
    expect({ insideTheWindow, wakes: pagasae.wakes.length }).toEqual({ insideTheWindow: { wakes: 1, handOvers: [] }, wakes: 2 });
  }, 60_000);

  it('hands nothing when pagasae refuses the wake', async () => {
    pagasae.answerWakes(503);
    await turnEmail(true);

    const messageId = await trackerSendsCharlotte();

    await expect.poll(() => pagasae.refusedWakes, { timeout: SEEN_WITHIN_MS }).toBeGreaterThan(0);
    expect({ wakes: pagasae.wakes, handOvers: await handOvers(messageId) }).toEqual({ wakes: [], handOvers: [] });
  });

  describe('with ten deliveries held, handed and not opened', () => {
    const HELD = 10;

    /** Ten deliveries handed through email and never acknowledged: the most one push receive returns. */
    async function holdTen(): Promise<void> {
      await turnEmail(true);
      const held = await Promise.all(Array.from({ length: HELD }, () => trackerSendsCharlotte()));
      for (const messageId of held) {
        await expect.poll(async () => handOvers(messageId), { timeout: SEEN_WITHIN_MS + WINDOW_MS }).toEqual(['email']);
      }
    }

    it('wakes for an eleventh delivery and hands it no. 1 through email', async () => {
      await holdTen();
      const wakesBefore = pagasae.wakes.length;

      const eleventh = await trackerSendsCharlotte();

      await expect.poll(async () => handOvers(eleventh), { timeout: SEEN_WITHIN_MS + WINDOW_MS }).toEqual(['email']);
      expect(pagasae.wakes.length).toBe(wakesBefore + 1);
    }, 120_000);

    it('wakes for the eleventh delivery again when the answer to the push receive that took it was lost before its hand-over', async () => {
      await holdTen();
      const wakesBefore = pagasae.wakes.length;
      lossy.loseNextTakenAnswer();

      const eleventh = await trackerSendsCharlotte();

      await expect.poll(async () => handOvers(eleventh), { timeout: FAILED_WAKE_AGAIN_MS + SEEN_WITHIN_MS }).toEqual(['email']);
      expect({ lost: lossy.lost, wakes: pagasae.wakes.length - wakesBefore }).toEqual({ lost: 1, wakes: 1 });
    }, 200_000);

    it('holds the eleventh delivery back while the window of the last wake runs, then hands it', async () => {
      await holdTen();
      const eleventh = await trackerSendsCharlotte();
      await expect.poll(async () => handOvers(eleventh), { timeout: SEEN_WITHIN_MS + WINDOW_MS }).toEqual(['email']);
      const twelfth = await trackerSendsCharlotte();
      await expect.poll(async () => (await historyOf(twelfth)).some(({ type }) => type === 'DeliveryReceived'), { timeout: SEEN_WITHIN_MS }).toBe(true);
      const insideTheWindow = await handOvers(twelfth);

      await expect.poll(async () => handOvers(twelfth), { timeout: SEEN_WITHIN_MS + WINDOW_MS }).toEqual(['email']);
      expect(insideTheWindow).toEqual([]);
    }, 180_000);

    it('hands the eleventh delivery through the page while a page of theirs is in focus, and sends no email', async () => {
      await holdTen();
      const wakesBefore = pagasae.wakes.length;
      const focused = createPrismaFocusedPages(prisma);
      const keepFocus = setInterval(() => void focused.save({ fleetId, shipId: charlotteShipId, pageId: 'page-1', seenAt: new Date() }), 1_000);
      await focused.save({ fleetId, shipId: charlotteShipId, pageId: 'page-1', seenAt: new Date() });

      try {
        const eleventh = await trackerSendsCharlotte();

        await expect.poll(async () => handOvers(eleventh), { timeout: SEEN_WITHIN_MS }).toEqual(['page']);
        expect(pagasae.wakes.length).toBe(wakesBefore);
      } finally {
        clearInterval(keepFocus);
      }
    }, 120_000);
  });
});
