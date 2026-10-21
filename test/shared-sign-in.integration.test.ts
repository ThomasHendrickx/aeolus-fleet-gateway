import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { createPrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaPendingRequests } from '../src/adapters/prisma/pending-requests.js';
import { createGatewayApp, type GatewayApp } from '../src/app.js';
import type { PendingRequest } from '../src/core/requests/ports.js';
import { gatewayApi } from '../web/lib/gateway-api/gateway-api.js';
import { migratedDatabase } from './support/database.js';
import { charlotteIn, PAGASAE_APP_CLIENT, PAGASAE_CLIENT, startFakePagasae, type FakePagasae } from './support/fake-pagasae.js';
import { aFreePort } from './support/fleet-server.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';

// A person signs in to the gateway's pages with the account sign-in every
// Aeolus app shares (header design H5): the gateway, an app at pagasae,
// sends them there and back, and its API then knows them as their account
// in the fleet the page names, by the token pagasae exchanges their sign-in
// for. Here pagasae is a fake; the gateway and its database are real.

const FLEET = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const SIGN_IN = 'charlotte-shared-sign-in';
const ORDERBOT_REQUEST: PendingRequest = {
  fleetId: FLEET,
  requestId: 'req_01m5c7hmbt9f1vrkwb37az0001',
  subject: { kind: 'client', clientId: 'https://orderbot.example.com/client.json', clientName: 'Orderbot' },
  requesters: [{ accountId: 'acc-charlotte', personShipId: null }],
  askedAt: new Date('2026-10-21T09:00:00.000Z'),
  expiresAt: new Date('2026-10-28T09:00:00.000Z'),
  state: 'pending',
  decidedBy: null,
  decidedAt: null,
};

let app: GatewayApp;
let pagasae: FakePagasae;
let address: string;
let databaseUrl: string;

beforeEach(async () => {
  pagasae = await startFakePagasae();
  const port = await aFreePort();
  databaseUrl = await migratedDatabase(inject('postgresUrl'));
  address = `http://127.0.0.1:${String(port)}`;
  app = createGatewayApp({
    databaseUrl,
    fleetUrl: 'http://127.0.0.1:9',
    logger: false,
    publicUrl: address,
    gatewaySecret: TEST_GATEWAY_SECRET,
    pagasae: { url: pagasae.url, ...PAGASAE_CLIENT },
    pagasaeApp: PAGASAE_APP_CLIENT,
  });
  await app.server.listen({ host: '127.0.0.1', port });
  pagasae.sharedSignIn(SIGN_IN, { ...charlotteIn(pagasae, FLEET), scope: 'fleet:read gateway:approve' });
});

afterEach(async () => {
  await app.close();
  await pagasae.stop();
});

/** The API's account.inView, as the web app's server asks it: the browser's cookies forwarded, and the fleet its page names. */
async function accountInView(sent: { cookie: string; fleet?: string }): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${address}/trpc/account.inView`, { headers: { cookie: sent.cookie, ...(sent.fleet === undefined ? {} : { 'aeolus-fleet': sent.fleet }) } });
  return { status: response.status, body: await response.json() };
}

describe("signing in to the gateway's pages with the shared sign-in", () => {
  it('goes to pagasae and back to the page asked for', async () => {
    const started = await fetch(`${address}/sign-in/start?return_to=${encodeURIComponent(`/overview?fleet=${FLEET}`)}`, { redirect: 'manual' });
    const browserSecret = (started.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const atPagasae = await fetch(started.headers.get('location') ?? '', { redirect: 'manual' });

    const back = await fetch(atPagasae.headers.get('location') ?? '', { redirect: 'manual', headers: { cookie: browserSecret } });

    expect({ status: back.status, location: back.headers.get('location') }).toEqual({ status: 302, location: `/overview?fleet=${FLEET}` });
  });

  it('knows the account in the fleet the page names, with the scopes pagasae gives it there', async () => {
    await expect(accountInView({ cookie: `aeolus_account_session=${SIGN_IN}`, fleet: FLEET })).resolves.toEqual({
      status: 200,
      body: { result: { data: { kind: 'signedIn', fleetId: FLEET, accountId: 'acc-charlotte', scopes: ['fleet:read', 'gateway:approve'] } } },
    });
  });

  it("is the account in the page's fleet to the web app's server, which forwards the browser's cookies", async () => {
    const api = gatewayApi({ url: address, cookie: `theme=dark; aeolus_account_session=${SIGN_IN}`, fleetId: FLEET });

    await expect(api.account.inView.query()).resolves.toEqual({ kind: 'signedIn', fleetId: FLEET, accountId: 'acc-charlotte', scopes: ['fleet:read', 'gateway:approve'] });
  });

  it('sends a page that names no fleet to the fleet whose gateway the account may open', async () => {
    await expect(accountInView({ cookie: `aeolus_account_session=${SIGN_IN}` })).resolves.toMatchObject({ status: 200, body: { result: { data: { kind: 'goTo', fleetId: FLEET } } } });
  });

  it('signs out of every app: the API knows the browser no more, though it knew it a moment before', async () => {
    await accountInView({ cookie: `aeolus_account_session=${SIGN_IN}`, fleet: FLEET });

    const out = await fetch(`${address}/sign-in/end`, { method: 'POST', redirect: 'manual', headers: { origin: address, cookie: `aeolus_account_session=${SIGN_IN}` } });

    expect(out.status).toBe(303);
    await expect(accountInView({ cookie: `aeolus_account_session=${SIGN_IN}`, fleet: FLEET })).resolves.toMatchObject({ status: 401 });
  });
});

describe("a page of the web app follows its fleet's request changes over the API, as the account signed in", () => {
  it('hears a request opened in the fleet as an event on the stream', async () => {
    const stop = new AbortController();
    const stream = await fetch(`${address}/trpc/requests.changes`, { headers: { accept: 'text/event-stream', cookie: `aeolus_account_session=${SIGN_IN}`, 'aeolus-fleet': FLEET }, signal: stop.signal });
    if (stream.body === null) {
      throw new Error('The stream has no body');
    }
    const reader = stream.body.pipeThrough(new TextDecoderStream()).getReader();
    const prisma = createPrismaClient(databaseUrl);
    let heard = '';
    try {
      // The stream is open once its first event, connected, comes.
      heard += (await reader.read()).value ?? '';
      await createPrismaPendingRequests(prisma).open({ ...ORDERBOT_REQUEST, now: new Date() });
      while (!heard.includes(`"fleetId":"${FLEET}"`)) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        heard += value;
      }
    } finally {
      stop.abort();
      await prisma.$disconnect();
    }

    expect({ status: stream.status, type: stream.headers.get('content-type'), heard: heard.includes(`"fleetId":"${FLEET}"`) }).toEqual({ status: 200, type: 'text/event-stream', heard: true });
  });
});
