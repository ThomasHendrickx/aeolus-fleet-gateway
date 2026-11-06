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

/** Charlotte turns email on for everything else, the job of the tracker's plain messages (Bridge, section 8). */
async function turnEmailOn(): Promise<void> {
  const turned = await fetch(`${address}/trpc/people.turnRoute`, { method: 'POST', headers: { 'content-type': 'application/json', ...asCharlotte() }, body: JSON.stringify({ job: 'everything-else', place: 'email', isOn: true }) });
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

  it('gets an email once they turned email on for the job, naming their person ship, and the delivery is handed no. 1 through email', async () => {
    await turnEmailOn();

    const messageId = await trackerSendsCharlotte();

    await expect.poll(async () => handOvers(messageId), { timeout: SEEN_WITHIN_MS }).toEqual(['email']);
    expect(pagasae.wakes).toEqual([{ fleetId, shipId: charlotteShipId }]);
  });

  it('gets one email per window: what arrives inside it waits for the next, and is handed then', async () => {
    await turnEmailOn();
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
    await turnEmailOn();

    const messageId = await trackerSendsCharlotte();

    await expect.poll(() => pagasae.refusedWakes, { timeout: SEEN_WITHIN_MS }).toBeGreaterThan(0);
    expect({ wakes: pagasae.wakes, handOvers: await handOvers(messageId) }).toEqual({ wakes: [], handOvers: [] });
  });

  describe('with ten deliveries held, handed and not opened', () => {
    const HELD = 10;

    /** Ten deliveries handed through email and never acknowledged: the most one push receive returns. */
    async function holdTen(): Promise<void> {
      await turnEmailOn();
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

describe("a person's quiet hours and quiet ships (preferences design)", () => {
  const ONE_HOUR_MINUTES = 60;
  const MINUTES_PER_DAY = 24 * 60;

  /** "HH:MM" of the minute of the day. */
  const timeOf = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

  /** Quiet hours in UTC from an hour ago to an hour from now, so they are in effect. */
  function aroundNow(): { from: string; to: string } {
    const now = new Date();
    const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
    return { from: timeOf((minute + MINUTES_PER_DAY - ONE_HOUR_MINUTES) % MINUTES_PER_DAY), to: timeOf((minute + ONE_HOUR_MINUTES) % MINUTES_PER_DAY) };
  }

  async function personCall(procedure: string, body: unknown): Promise<Response> {
    return fetch(`${address}/trpc/people.${procedure}`, { method: 'POST', headers: { 'content-type': 'application/json', ...asCharlotte() }, body: JSON.stringify(body) });
  }

  async function personRead(procedure: string, input?: unknown): Promise<unknown> {
    const search = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`;
    const read = await fetch(`${address}/trpc/people.${procedure}${search}`, { headers: asCharlotte() });
    expect(read.status).toBe(200);
    return z.object({ result: z.object({ data: z.unknown() }) }).parse(await read.json()).result.data;
  }

  async function trackerShipId(): Promise<ShipId> {
    const who = await createRestFleetDoor(fleet.url).whoami(tracker);
    if (!who.isOk) {
      throw new Error('the tracker is not crewed');
    }
    return who.value.shipId;
  }

  const waitMs = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  it('sets and reads quiet hours, in effect now, through the person API', async () => {
    const { from, to } = aroundNow();

    expect((await personCall('setQuietHours', { isOn: true, from, to, timeZone: 'UTC' })).status).toBe(200);

    const read = z.object({ isOn: z.boolean(), window: z.unknown(), quietNow: z.object({ since: z.iso.datetime(), until: z.iso.datetime() }).nullable() }).parse(await personRead('quietHours'));
    expect({ isOn: read.isOn, window: read.window, isQuietNow: read.quietNow !== null }).toEqual({ isOn: true, window: { from, to, timeZone: 'UTC' }, isQuietNow: true });
  });

  it('refuses quiet hours that end when they start', async () => {
    expect((await personCall('setQuietHours', { isOn: true, from: '22:00', to: '22:00', timeZone: 'UTC' })).status).toBe(400);
  });

  it('quiets a ship, lists it, and marks it among the ships asked, through the person API', async () => {
    const shipId = await trackerShipId();

    expect((await personCall('turnShipQuiet', { shipId, name: 'tracker', isQuiet: true })).status).toBe(200);

    const quietShipSchema = z.object({ shipId: z.string(), name: z.string(), since: z.iso.datetime() });
    const listed = z.object({ ships: z.array(quietShipSchema), nextCursor: z.string().nullable() }).parse(await personRead('quietShips', { cursor: null }));
    const among = z.array(quietShipSchema).parse(await personRead('quietAmong', { shipIds: [shipId, charlotteShipId] }));
    expect({ listed: listed.ships.map(({ shipId: id, name }) => ({ id, name })), nextCursor: listed.nextCursor, among: among.map(({ shipId: id }) => id) }).toEqual({ listed: [{ id: shipId, name: 'tracker' }], nextCursor: null, among: [shipId] });
  });

  it('gets no email from a quiet ship, and its delivery waits unhanded', async () => {
    await turnEmailOn();
    expect((await personCall('turnShipQuiet', { shipId: await trackerShipId(), name: 'tracker', isQuiet: true })).status).toBe(200);

    const messageId = await trackerSendsCharlotte();

    await expect.poll(async () => (await historyOf(messageId)).some(({ type }) => type === 'DeliveryReceived'), { timeout: SEEN_WITHIN_MS }).toBe(true);
    expect({ wakes: pagasae.wakes, handOvers: await handOvers(messageId) }).toEqual({ wakes: [], handOvers: [] });
  });

  it('gets no email during quiet hours, and one by the next window once they are turned off', async () => {
    await turnEmailOn();
    const { from, to } = aroundNow();
    expect((await personCall('setQuietHours', { isOn: true, from, to, timeZone: 'UTC' })).status).toBe(200);
    const messageId = await trackerSendsCharlotte();
    await expect.poll(async () => (await historyOf(messageId)).some(({ type }) => type === 'DeliveryReceived'), { timeout: SEEN_WITHIN_MS }).toBe(true);
    // Past a whole window, the waiter looked again and still sent nothing.
    await waitMs(WINDOW_MS + 2_000);
    const duringQuietHours = { wakes: pagasae.wakes.length, handOvers: await handOvers(messageId) };

    expect((await personCall('setQuietHours', { isOn: false, from, to, timeZone: 'UTC' })).status).toBe(200);

    await expect.poll(async () => handOvers(messageId), { timeout: SEEN_WITHIN_MS + WINDOW_MS }).toEqual(['email']);
    expect({ duringQuietHours, wakes: pagasae.wakes.length }).toEqual({ duringQuietHours: { wakes: 0, handOvers: [] }, wakes: 1 });
  }, 90_000);
});
