import { FLEET_HEADER, idSchema, needsAttentionOutputSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createPartySignIns } from '../src/adapters/oauth/party-sign-ins.js';
import { createPrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaPartyGrants } from '../src/adapters/prisma/party-grants.js';
import { createPrismaPartyStore } from '../src/adapters/prisma/party-store.js';
import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { signInServersOf } from '../src/core/parties/sign-in-servers.js';
import { createKeepGrantsAlive } from '../src/core/party-grants/keep-grants-alive.js';
import { createRefreshGrant } from '../src/core/party-grants/refresh-grant.js';
import { startAttioDouble, type AttioDouble } from './fixtures/attio-double/attio-double.js';
import { commission, register, setOwner, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { charlotteIn, PAGASAE_APP_CLIENT, PAGASAE_CLIENT, startFakePagasae, type FakePagasae } from './support/fake-pagasae.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';
import { connectGateway, mutate } from './support/gateway-api.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';
import { outsidePartiesOn } from './support/outside-parties.js';
import { receiveOne, send } from './support/ship.js';

// A ship calls an outside MCP server where each person signs in, under its
// owner's grant (decision 0067, oauth-servers S4): the owner read from core
// at hand-over, Q5's and Q10's error results, the person told once, a 401
// refreshing the grant once, a 403 insufficient_scope, and a restart that
// never calls again; and grants kept alive (S5): one refresh at a time, also
// across two gateway instances, a refresh ahead and on a schedule, and a
// grant lost at invalid_grant. The gateway, the fleet and the Attio double are real;
// pagasae is its double.

const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify'];
const PUBLIC_URL = 'https://gateway.example.com';
const MATHILDE_BROWSER = 'mathilde-shared-sign-in';
const JORIS_BROWSER = 'joris-shared-sign-in';
const TOOL_CALL_TIMEOUT_MS = 1_000;
/** Two days: longer than a grant may go unrefreshed (Q7). */
const IDLE_FOR_MS = 2 * 24 * 60 * 60 * 1000;
/** How many times a test reads Needs attention, a tool call timeout apart, before it counts it empty. */
const NEEDS_ATTENTION_TRIES = 10;

let fleet: FleetServer;
let pagasae: FakePagasae;
let attio: AttioDouble;
let cookie: string;
let databaseUrl: string;
let fleetId: FleetId;
let mathilde: { shipId: ShipId; crewToken: string };
let joris: { shipId: ShipId; crewToken: string };
let address: string;
const apps: GatewayApp[] = [];
let proxyShipId: ShipId;

/** How often the gateway's schedule looks for grants to keep alive in these tests. */
const GRANT_ROUND_MS = 100;

/** The gateway as it starts: its parties' proxy ships crewed again, its calls taken. */
async function gatewayStarted(): Promise<void> {
  const app = createGatewayApp({
    grantRoundMs: GRANT_ROUND_MS,
    gatewaySecret: TEST_GATEWAY_SECRET,
    databaseUrl,
    fleetUrl: fleet.url,
    logger: false,
    publicUrl: PUBLIC_URL,
    toolCallTimeoutMs: TOOL_CALL_TIMEOUT_MS,
    pagasae: { url: pagasae.url, ...PAGASAE_CLIENT },
    pagasaeApp: PAGASAE_APP_CLIENT,
  });
  apps.push(app);
  await app.restoreConnections();
  address = await app.server.listen({ host: '127.0.0.1', port: 0 });
}

async function gatewayStopped(): Promise<void> {
  await Promise.all(apps.splice(0).map((app) => app.close()));
}

/** Mathilde, an approver, adds Attio with each person signing in, and signs in for herself (Q15). */
async function attioAdded(): Promise<void> {
  await gatewayStarted();
  const gatewayShip = await commission(fleet, { cookie, ship: { name: 'gateway', type: 'gateway', kind: 'app', scopes: GATEWAY_SCOPES } });
  expect((await connectGateway(address, { cookie, ...gatewayShip })).status).toBe(200);
  const added = await mutate(address, { procedure: 'parties.approve', cookie, body: { requestId: 'add-attio', name: 'attio', url: attio.url, credential: { kind: 'personSignIn' }, ownerShipId: mathilde.shipId } });
  expect(added.status, await added.clone().text()).toBe(200);
  proxyShipId = z.object({ result: z.object({ data: z.object({ proxyShipId: idSchema('ship') }) }) }).parse(await added.json()).result.data.proxyShipId;
}

beforeEach(async () => {
  [fleet, databaseUrl, pagasae, attio] = await Promise.all([startFleetServer(inject('postgresUrl')), migratedDatabase(inject('postgresUrl')), startFakePagasae(), startAttioDouble()]);
  cookie = await signIn(fleet);
  const mathildeShip = await commission(fleet, { cookie, ship: { name: 'mathilde', type: 'person', kind: 'person' } });
  const jorisShip = await commission(fleet, { cookie, ship: { name: 'joris', type: 'person', kind: 'person' } });
  mathilde = { shipId: mathildeShip.shipId, crewToken: await register(fleet, mathildeShip) };
  joris = { shipId: jorisShip.shipId, crewToken: await register(fleet, jorisShip) };
  const whoami = await fetch(`${fleet.url}/api/v1/ship/whoami`, { headers: { authorization: `Bearer ${mathilde.crewToken}` } });
  fleetId = z.object({ fleetId: idSchema('fleet') }).parse(await whoami.json()).fleetId;
  pagasae.sharedSignIn(MATHILDE_BROWSER, { ...charlotteIn(pagasae, fleetId), sub: 'acc-mathilde', scope: 'fleet:read gateway:approve', person_ship: mathilde.shipId });
  pagasae.sharedSignIn(JORIS_BROWSER, { ...charlotteIn(pagasae, fleetId), sub: 'acc-joris', person_ship: joris.shipId });
  await outsidePartiesOn(databaseUrl, fleetId);
});

afterEach(async () => {
  await gatewayStopped();
  await Promise.all([attio.close(), fleet.stop(), pagasae.stop()]);
});

const startedSchema = z.object({ result: z.object({ data: z.object({ url: z.string() }) }) });

/** A person signs in to Attio on its page, as the given outside account, through to the gateway's callback. */
async function signedIn(browser: string, account: { subject: string; email: string }): Promise<void> {
  attio.signIn = account;
  const headers = { cookie: `aeolus_account_session=${browser}`, [FLEET_HEADER]: fleetId, 'content-type': 'application/json' };
  const started = await fetch(`${address}/trpc/parties.startSignIn`, { method: 'POST', headers, body: JSON.stringify({ name: 'attio' }) });
  expect(started.status, await started.clone().text()).toBe(200);
  const authorized = await fetch(startedSchema.parse(await started.json()).result.data.url, { redirect: 'manual' });
  const back = new URL(authorized.headers.get('location') ?? '');
  const done = await fetch(`${address}${back.pathname}${back.search}`, { headers: { cookie: `aeolus_account_session=${browser}` }, redirect: 'manual' });
  expect(new URL(done.headers.get('location') ?? '', PUBLIC_URL).searchParams.get('sign-in')).toBe('signed-in');
}

const MATHILDE_ACCOUNT = { subject: 'attio-member-mathilde', email: 'mathilde@acme.example' };
const JORIS_ACCOUNT = { subject: 'attio-member-joris', email: 'joris@acme.example' };

/** A ship of the fleet that may send, owned by the person named, or by argo when none is. */
async function aShip(name: string, owner?: ShipId): Promise<{ shipId: ShipId; crewToken: string }> {
  const ship = await commission(fleet, { cookie, ship: { name, type: 'agent', scopes: ['messages:send'] } });
  if (owner !== undefined) {
    await setOwner(fleet, { cookie, shipId: ship.shipId, ownerShipId: owner });
  }
  return { shipId: ship.shipId, crewToken: await register(fleet, ship) };
}

function searchRecords(ship: { crewToken: string }): Promise<string> {
  return send(fleet, { crewToken: ship.crewToken, to: proxyShipId, contentType: 'application/vnd.aeolus.mcp-tool+json; name=search_records', payload: JSON.stringify({ query: 'acme' }) });
}

const resultSchema = z.object({ content: z.array(z.object({ type: z.literal('text'), text: z.string() })), isError: z.boolean().optional() });

/** The ship's reply to its call: its request and the result's text. */
async function replyTo(ship: { crewToken: string }) {
  const reply = await receiveOne(fleet, ship.crewToken);
  const result = resultSchema.parse(JSON.parse(reply?.payload ?? 'null'));
  return { inReplyTo: reply?.inReplyTo, text: result.content.map(({ text }) => text).join(''), isError: result.isError ?? false };
}

const PAGE = () => `${PUBLIC_URL}/outside-parties/attio?fleet=${fleetId}`;
const noSignIn = (person: string) => `${person}, who owns the calling ship, has no working sign-in to attio: sign in on ${PAGE()}, then call again.`;

async function keptGrants() {
  const prisma = createPrismaClient(databaseUrl);
  try {
    return await prisma.partyGrant.findMany();
  } finally {
    await prisma.$disconnect();
  }
}

describe("a ship calls an outside MCP server under its owner's grant", () => {
  it("goes out with its owner's access token, Attio records her outside account, and the result is the reply (scenario 11)", async () => {
    await attioAdded();
    await signedIn(MATHILDE_BROWSER, MATHILDE_ACCOUNT);
    const leadScout = await aShip('lead-scout', mathilde.shipId);

    const request = await searchRecords(leadScout);

    await expect(replyTo(leadScout)).resolves.toEqual({ inReplyTo: request, text: 'records for acme', isError: false });
    expect(attio.calledAs).toEqual(['attio-member-mathilde']);
    expect((await keptGrants()).map(({ personShipId, lastUsedAt }) => ({ personShipId, isUsed: lastUsedAt !== null }))).toEqual([{ personShipId: mathilde.shipId, isUsed: true }]);
  });

  it("answers at once an error result naming the owner's missing sign-in and the page, and Attio never sees the call (scenario 12)", async () => {
    await attioAdded();
    const leadScout = await aShip('lead-scout', joris.shipId);

    const request = await searchRecords(leadScout);

    await expect(replyTo(leadScout)).resolves.toEqual({ inReplyTo: request, text: noSignIn('joris'), isError: true });
    expect(attio.calledAs).toEqual([]);
  });

  it("tells the owner once with the page's link, and not again at another of their ships' call (scenario 12, 13)", async () => {
    await attioAdded();
    const leadScout = await aShip('lead-scout', joris.shipId);
    const otherScout = await aShip('other-scout', joris.shipId);
    await searchRecords(leadScout);
    await replyTo(leadScout);

    await searchRecords(otherScout);

    await expect(replyTo(otherScout)).resolves.toMatchObject({ text: noSignIn('joris') });
    const told = await receiveOne(fleet, joris.crewToken);
    expect({ contentType: told?.contentType, isLinked: told?.payload.includes(PAGE()) }).toEqual({ contentType: 'text/plain', isLinked: true });
    await expect(receiveOne(fleet, joris.crewToken)).resolves.toBeUndefined();
  });

  it('answers a ship argo owns an error result saying no person can sign in for it, messaging nobody (scenario 14)', async () => {
    await attioAdded();
    await signedIn(MATHILDE_BROWSER, MATHILDE_ACCOUNT);
    const argoScout = await aShip('argo-scout');

    await searchRecords(argoScout);

    await expect(replyTo(argoScout)).resolves.toMatchObject({ text: 'No person can sign in to attio for argo-scout, which argo owns: it calls attio once a person owns it.', isError: true });
    expect(attio.calledAs).toEqual([]);
    await expect(Promise.all([receiveOne(fleet, mathilde.crewToken), receiveOne(fleet, joris.crewToken)])).resolves.toEqual([undefined, undefined]);
  });

  it('lets a call that waited while its owner signed in go out under the new grant (scenario 15)', async () => {
    await attioAdded();
    const leadScout = await aShip('lead-scout', joris.shipId);
    await gatewayStopped();
    const request = await searchRecords(leadScout);
    // Back up with its routes only, so the call waits until the proxy ship is crewed again below.
    const app = createGatewayApp({ gatewaySecret: TEST_GATEWAY_SECRET, databaseUrl, fleetUrl: fleet.url, logger: false, publicUrl: PUBLIC_URL, pagasae: { url: pagasae.url, ...PAGASAE_CLIENT }, pagasaeApp: PAGASAE_APP_CLIENT });
    apps.push(app);
    address = await app.server.listen({ host: '127.0.0.1', port: 0 });
    await signedIn(JORIS_BROWSER, JORIS_ACCOUNT);

    await app.restoreConnections();

    await expect(replyTo(leadScout)).resolves.toEqual({ inReplyTo: request, text: 'records for acme', isError: false });
    expect(attio.calledAs).toEqual(['attio-member-joris']);
  });

  it("answers Q5's error result to the ship's next call once its owner removed her grant (scenario 24)", async () => {
    await attioAdded();
    await signedIn(MATHILDE_BROWSER, MATHILDE_ACCOUNT);
    const leadScout = await aShip('lead-scout', mathilde.shipId);
    const removed = await fetch(`${address}/trpc/parties.removeOwnSignIn`, {
      method: 'POST',
      headers: { cookie: `aeolus_account_session=${MATHILDE_BROWSER}`, [FLEET_HEADER]: fleetId, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'attio' }),
    });
    expect(removed.status).toBe(200);

    await searchRecords(leadScout);

    await expect(replyTo(leadScout)).resolves.toMatchObject({ text: noSignIn('mathilde'), isError: true });
    expect(attio.calledAs).toEqual([]);
  });
});

describe('a call the server refuses under its grant', () => {
  it('refreshes the grant once when Attio refuses the access token 401, and the call goes out again with the new one (scenario 18)', async () => {
    await attioAdded();
    await signedIn(MATHILDE_BROWSER, MATHILDE_ACCOUNT);
    const leadScout = await aShip('lead-scout', mathilde.shipId);
    attio.endAccessTokens();

    await searchRecords(leadScout);

    await expect(replyTo(leadScout)).resolves.toMatchObject({ text: 'records for acme', isError: false });
    expect(attio.refreshed).toEqual(['attio-refresh-2']);
    expect(await keptGrants()).toMatchObject([{ accessToken: 'attio-access-3', refreshToken: 'attio-refresh-3' }]);
  });

  it("answers Q5's error result at a second 401 and tells the owner, refreshing once (scenario 18)", async () => {
    await attioAdded();
    await signedIn(MATHILDE_BROWSER, MATHILDE_ACCOUNT);
    const leadScout = await aShip('lead-scout', mathilde.shipId);
    attio.isRefusingEveryAccessToken = true;

    await searchRecords(leadScout);

    await expect(replyTo(leadScout)).resolves.toMatchObject({ text: noSignIn('mathilde'), isError: true });
    expect(attio.refreshed).toHaveLength(1);
    await expect(receiveOne(fleet, mathilde.crewToken).then((told) => told?.payload.includes(PAGE()))).resolves.toBe(true);
  });

  it('answers an error result naming the page to sign in again on at a 403 insufficient_scope, keeping the grant (scenario 23)', async () => {
    await attioAdded();
    await signedIn(MATHILDE_BROWSER, MATHILDE_ACCOUNT);
    const leadScout = await aShip('lead-scout', mathilde.shipId);
    attio.insufficientScopeTools = ['search_records'];

    await searchRecords(leadScout);

    await expect(replyTo(leadScout)).resolves.toMatchObject({
      text: `attio refused the call: the sign-in of mathilde, who owns the calling ship, lacks a scope it needs. Sign in again on ${PAGE()}, then call again.`,
      isError: true,
    });
    expect(await keptGrants()).toMatchObject([{ personShipId: mathilde.shipId, accessToken: 'attio-access-2' }]);
    expect(attio.refreshed).toEqual([]);
  });
});

describe('a restart under a grant', () => {
  /** Needs attention as argo reads it, once it lists a delivery. */
  async function needsAttention() {
    for (let tries = 0; tries < NEEDS_ATTENTION_TRIES; tries += 1) {
      const response = await fetch(`${fleet.url}/trpc/fleet.needsAttention?input=${encodeURIComponent(JSON.stringify({}))}`, { headers: { cookie } });
      const listed = needsAttentionOutputSchema.parse(z.object({ result: z.object({ data: z.unknown() }) }).parse(await response.json()).result.data).items;
      if (listed.length > 0) {
        return listed;
      }
      await new Promise((resolve) => setTimeout(resolve, TOOL_CALL_TIMEOUT_MS));
    }
    return [];
  }

  it('never calls again a call that may have run when the gateway stopped mid call', async () => {
    await attioAdded();
    await signedIn(MATHILDE_BROWSER, MATHILDE_ACCOUNT);
    const leadScout = await aShip('lead-scout', mathilde.shipId);
    attio.isHoldingCalls = true;
    await searchRecords(leadScout);
    await expect.poll(() => attio.calledAs.length).toBe(1);
    await gatewayStopped();

    await gatewayStarted();

    await expect(needsAttention().then((listed) => listed.map(({ state, ship }) => ({ state, shipId: ship.id })))).resolves.toEqual([{ state: 'notHandled', shipId: proxyShipId }]);
    expect(attio.calledAs).toEqual(['attio-member-mathilde']);
  });
});

/** A person's own sign-in to Attio, as their page reads it. */
async function ownSignIn(browser: string): Promise<unknown> {
  const response = await fetch(`${address}/trpc/parties.ownSignIn?input=${encodeURIComponent(JSON.stringify({ name: 'attio' }))}`, { headers: { cookie: `aeolus_account_session=${browser}`, [FLEET_HEADER]: fleetId } });
  expect(response.status, await response.clone().text()).toBe(200);
  return z.object({ result: z.object({ data: z.unknown() }) }).parse(await response.json()).result.data;
}

/** Sets a person's grant as signed in two days ago and never refreshed since: idle for longer than the schedule lets a grant be. */
async function grantIdle(personShipId: ShipId): Promise<void> {
  const prisma = createPrismaClient(databaseUrl);
  try {
    await prisma.partyGrant.updateMany({ where: { personShipId }, data: { signedInAt: new Date(Date.now() - IDLE_FOR_MS), refreshedAt: null } });
  } finally {
    await prisma.$disconnect();
  }
}

describe('keeping grants alive (Q7)', () => {
  it('refreshes once for two calls Attio refuses at once, both answered under the new token, the old refresh token never used again (scenario 17)', async () => {
    await attioAdded();
    await signedIn(MATHILDE_BROWSER, MATHILDE_ACCOUNT);
    const [leadScout, otherScout] = await Promise.all([aShip('lead-scout', mathilde.shipId), aShip('other-scout', mathilde.shipId)]);
    attio.endAccessTokens();

    await Promise.all([searchRecords(leadScout), searchRecords(otherScout)]);

    await expect(Promise.all([replyTo(leadScout), replyTo(otherScout)])).resolves.toMatchObject([
      { text: 'records for acme', isError: false },
      { text: 'records for acme', isError: false },
    ]);
    expect(attio.refreshed).toEqual(['attio-refresh-2']);
    expect(attio.authorizations.slice(-2)).toEqual(['Bearer attio-access-3', 'Bearer attio-access-3']);
  });

  it('refreshes a grant once when two gateway instances on one database keep it alive at once (scenario 17)', async () => {
    await attioAdded();
    await signedIn(MATHILDE_BROWSER, MATHILDE_ACCOUNT);
    await gatewayStopped();
    await grantIdle(mathilde.shipId);
    const instances = [createPrismaClient(databaseUrl), createPrismaClient(databaseUrl)];
    const rounds = instances.map((prisma) => {
      const grants = createPrismaPartyGrants(prisma);
      const clock = { now: () => new Date() };
      const tellSignInNeeded = () => Promise.resolve();
      return createKeepGrantsAlive({ grants, servers: signInServersOf(createPrismaPartyStore(prisma)), refreshGrant: createRefreshGrant({ signIns: createPartySignIns(), grants, tellSignInNeeded, clock }), clock });
    });

    try {
      await Promise.all(rounds.map((round) => round()));
    } finally {
      await Promise.all(instances.map((prisma) => prisma.$disconnect()));
    }

    expect(attio.refreshed).toEqual(['attio-refresh-2']);
    expect(await keptGrants()).toMatchObject([{ accessToken: 'attio-access-3', refreshToken: 'attio-refresh-3', lostAt: null }]);
  });

  it("loses the grant when Attio answers the refresh invalid_grant: the call gets Q5's error result, the owner is told once, and her page shows it lost (scenario 19)", async () => {
    await attioAdded();
    await signedIn(MATHILDE_BROWSER, MATHILDE_ACCOUNT);
    const leadScout = await aShip('lead-scout', mathilde.shipId);
    attio.endAccessTokens();
    attio.spendRefreshTokens();

    await searchRecords(leadScout);

    await expect(replyTo(leadScout)).resolves.toMatchObject({ text: noSignIn('mathilde'), isError: true });
    const told = await receiveOne(fleet, mathilde.crewToken);
    expect(told?.payload).toContain('Your sign-in to attio ended');
    expect(told?.payload).toContain(PAGE());
    await expect(receiveOne(fleet, mathilde.crewToken)).resolves.toBeUndefined();
    await expect(ownSignIn(MATHILDE_BROWSER)).resolves.toMatchObject({ state: 'lost', outsideAccount: { subject: 'attio-member-mathilde' }, lost: { why: "invalid_grant: The refresh token is unknown, used or not this client's" } });
  });

  it('keeps the grant and hands the call again while Attio\'s authorization server is down, and the call goes out once it is back (scenario 20)', async () => {
    await attioAdded();
    await signedIn(MATHILDE_BROWSER, MATHILDE_ACCOUNT);
    const leadScout = await aShip('lead-scout', mathilde.shipId);
    attio.endAccessTokens();
    attio.isTokenEndpointDown = true;
    const request = await searchRecords(leadScout);
    await expect.poll(() => attio.tokenRequestsWhileDown).toBeGreaterThan(0);
    expect(await keptGrants()).toMatchObject([{ refreshToken: 'attio-refresh-2', lostAt: null }]);

    attio.isTokenEndpointDown = false;

    await expect(replyTo(leadScout)).resolves.toEqual({ inReplyTo: request, text: 'records for acme', isError: false });
    expect(attio.refreshed).toEqual(['attio-refresh-2']);
  });

  it('refreshes a grant idle for longer than its schedule without a call, keeping the new refresh token (scenario 21)', async () => {
    await attioAdded();
    await signedIn(MATHILDE_BROWSER, MATHILDE_ACCOUNT);
    await gatewayStopped();
    await grantIdle(mathilde.shipId);

    await gatewayStarted();

    await expect.poll(() => attio.refreshed).toEqual(['attio-refresh-2']);
    await expect.poll(async () => (await keptGrants()).map(({ refreshToken, refreshedAt }) => ({ refreshToken, isRefreshed: refreshedAt !== null }))).toEqual([{ refreshToken: 'attio-refresh-3', isRefreshed: true }]);
    expect(attio.calledAs).toEqual([]);
  });

  it("loses the grant at the next refresh when the gateway stopped after Attio rotated its refresh token, tells the owner, and the next call gets Q5's error result (scenario 22)", async () => {
    await attioAdded();
    await signedIn(MATHILDE_BROWSER, MATHILDE_ACCOUNT);
    const leadScout = await aShip('lead-scout', mathilde.shipId);
    await gatewayStopped();
    attio.spendRefreshTokens();
    await grantIdle(mathilde.shipId);

    await gatewayStarted();

    await expect.poll(async () => (await keptGrants()).map(({ lostAt }) => lostAt !== null)).toEqual([true]);
    await expect(receiveOne(fleet, mathilde.crewToken).then((told) => told?.payload)).resolves.toContain('Your sign-in to attio ended');
    const request = await searchRecords(leadScout);
    await expect(replyTo(leadScout)).resolves.toEqual({ inReplyTo: request, text: noSignIn('mathilde'), isError: true });
    expect(attio.calledAs).toEqual([]);
  });
});
