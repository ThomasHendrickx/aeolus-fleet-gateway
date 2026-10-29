import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaPersonCrews } from '../src/adapters/prisma/person-crews.js';
import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { commission, register, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { charlotteIn, PAGASAE_APP_CLIENT, PAGASAE_CLIENT, startFakePagasae, type FakePagasae } from './support/fake-pagasae.js';
import { aFreePort, startFleetServer, type FleetServer } from './support/fleet-server.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';

// A person's open overview and inbox change within seconds, without a
// reload, when a delivery reaches their person ship and when they open one
// in another client (wake a person, #1014): the gateway's waiter of the ship
// tells the pages, which read people.inbox again. The fleet and the gateway
// are real; pagasae is a fake.

const SIGN_IN = 'charlotte-shared-sign-in';
const HEARD_WITHIN_MS = 15_000;

let fleet: FleetServer;
let pagasae: FakePagasae;
let app: GatewayApp;
let prisma: PrismaClient;
let address: string;
let fleetId: string;
let tracker: string;

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
    fleetUrl: fleet.url,
    logger: false,
    publicUrl: address,
    gatewaySecret: TEST_GATEWAY_SECRET,
    pagasae: { url: pagasae.url, ...PAGASAE_CLIENT },
    pagasaeApp: PAGASAE_APP_CLIENT,
  });
  await app.server.listen({ host: '127.0.0.1', port });
  await app.restoreConnections();
});

afterEach(async () => {
  await app.close();
  await prisma.$disconnect();
  await pagasae.stop();
  await fleet.stop();
});

const asCharlotte = (): Record<string, string> => ({ cookie: `aeolus_account_session=${SIGN_IN}`, 'aeolus-fleet': fleetId });

/** Charlotte's open overview: the stream its page follows, each event telling it to read itself again. */
async function charlottesOverview() {
  const stop = new AbortController();
  const stream = await fetch(`${address}/trpc/requests.changes`, { headers: { accept: 'text/event-stream', ...asCharlotte() }, signal: stop.signal });
  if (stream.body === null) {
    throw new Error('The stream has no body');
  }
  const reader = stream.body.pipeThrough(new TextDecoderStream()).getReader();
  // The stream is open once its first event, connected, comes.
  await reader.read();
  return {
    /** Whether the page is told to read itself again within the time a person waits. */
    isToldToReadAgain: async (): Promise<boolean> => {
      let heard = '';
      const deadline = setTimeout(() => {
        void reader.cancel();
      }, HEARD_WITHIN_MS);
      try {
        while (!heard.includes(`"fleetId":"${fleetId}"`)) {
          const { value, done } = await reader.read();
          if (done) {
            return false;
          }
          heard += value;
        }
        return true;
      } finally {
        clearTimeout(deadline);
      }
    },
    close: () => {
      stop.abort();
    },
  };
}

async function trackerSendsCharlotte(): Promise<void> {
  const sent = await fetch(`${fleet.url}/api/v1/ship/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tracker}` },
    body: JSON.stringify({ selector: { kind: 'ship', name: 'charlotte' }, contentType: 'text/plain', payload: 'Issue 7 is closed', idempotencyKey: crypto.randomUUID() }),
  });
  expect(sent.status).toBe(200);
}

const inboxAnswerSchema = z.object({ result: z.object({ data: z.object({ waiting: z.int(), deliveries: z.array(z.object({ deliveryId: z.string() })) }) }) });

/** Charlotte's inbox, as their pages read it. */
async function charlottesInbox() {
  const read = await fetch(`${address}/trpc/people.inbox`, { headers: asCharlotte() });
  return inboxAnswerSchema.parse(await read.json()).result.data;
}

describe("a person's open overview, as their person ship's inbox changes", () => {
  it('is told to read itself again when a delivery reaches their person ship', async () => {
    const overview = await charlottesOverview();

    await trackerSendsCharlotte();

    try {
      await expect(overview.isToldToReadAgain()).resolves.toBe(true);
    } finally {
      overview.close();
    }
  });

  it('is told to read itself again when they open a delivery in another client', async () => {
    await trackerSendsCharlotte();
    await expect.poll(async () => (await charlottesInbox()).waiting, { timeout: HEARD_WITHIN_MS }).toBe(1);
    const [delivery] = (await charlottesInbox()).deliveries;
    const overview = await charlottesOverview();

    const opened = await fetch(`${address}/trpc/people.open`, { method: 'POST', headers: { 'content-type': 'application/json', ...asCharlotte() }, body: JSON.stringify({ deliveryId: delivery?.deliveryId }) });
    expect(opened.status).toBe(200);

    try {
      await expect(overview.isToldToReadAgain()).resolves.toBe(true);
    } finally {
      overview.close();
    }
  });
});
