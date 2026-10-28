import { FLEET_HEADER, discoverOutputSchema, idSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient } from '../src/adapters/prisma/client.js';
import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { startAttioDouble, type AttioDouble, type AttioDoubleOptions } from './fixtures/attio-double/attio-double.js';
import { commission, register, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { charlotteIn, PAGASAE_APP_CLIENT, PAGASAE_CLIENT, startFakePagasae, type FakePagasae } from './support/fake-pagasae.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';
import { connectGateway, mutate } from './support/gateway-api.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';
import { outsidePartiesOn } from './support/outside-parties.js';

// A person signs in to an outside MCP server where each person signs in
// (decision 0067, oauth-servers S3), against an authorization server double
// shaped as Attio's: PKCE, the state bound to the browser's shared sign-in,
// the token exchange, the grant kept per person with its outside account,
// Q13, removing one's own grant, and the proxy ship stated from the first
// grant. The gateway, the fleet and the Attio double are real; pagasae is
// its double.

const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify'];
const PUBLIC_URL = 'https://gateway.example.com';
const MATHILDE_BROWSER = 'mathilde-shared-sign-in';
const JORIS_BROWSER = 'joris-shared-sign-in';

let fleet: FleetServer;
let pagasae: FakePagasae;
let attio: AttioDouble;
let cookie: string;
let databaseUrl: string;
let fleetId: FleetId;
let mathilde: ShipId;
let address: string;
let app: GatewayApp;

async function started(options: AttioDoubleOptions = {}): Promise<void> {
  attio = await startAttioDouble(options);
  app = createGatewayApp({
    gatewaySecret: TEST_GATEWAY_SECRET,
    databaseUrl,
    fleetUrl: fleet.url,
    logger: false,
    publicUrl: PUBLIC_URL,
    pagasae: { url: pagasae.url, ...PAGASAE_CLIENT },
    pagasaeApp: PAGASAE_APP_CLIENT,
  });
  address = await app.server.listen({ host: '127.0.0.1', port: 0 });
  const gatewayShip = await commission(fleet, { cookie, ship: { name: 'gateway', type: 'gateway', kind: 'app', scopes: GATEWAY_SCOPES } });
  expect((await connectGateway(address, { cookie, ...gatewayShip })).status).toBe(200);
  const added = await mutate(address, { procedure: 'parties.approve', cookie, body: { requestId: 'add-attio', name: 'attio', url: attio.url, credential: { kind: 'personSignIn' }, ownerShipId: mathilde } });
  expect(added.status, await added.clone().text()).toBe(200);
}

beforeEach(async () => {
  [fleet, databaseUrl, pagasae] = await Promise.all([startFleetServer(inject('postgresUrl')), migratedDatabase(inject('postgresUrl')), startFakePagasae()]);
  cookie = await signIn(fleet);
  mathilde = (await commission(fleet, { cookie, ship: { name: 'mathilde', type: 'person', kind: 'person' } })).shipId;
  const joris = (await commission(fleet, { cookie, ship: { name: 'joris', type: 'person', kind: 'person' } })).shipId;
  const agent = await commission(fleet, { cookie, ship: { name: 'agent', type: 'agent' } });
  const whoami = await fetch(`${fleet.url}/api/v1/ship/whoami`, { headers: { authorization: `Bearer ${await register(fleet, agent)}` } });
  fleetId = z.object({ fleetId: idSchema('fleet') }).parse(await whoami.json()).fleetId;
  pagasae.sharedSignIn(MATHILDE_BROWSER, { ...charlotteIn(pagasae, fleetId), sub: 'acc-mathilde', scope: 'fleet:read gateway:approve', person_ship: mathilde });
  pagasae.sharedSignIn(JORIS_BROWSER, { ...charlotteIn(pagasae, fleetId), sub: 'acc-joris', person_ship: joris });
  await outsidePartiesOn(databaseUrl, fleetId);
});

afterEach(async () => {
  await app.close();
  await Promise.all([attio.close(), fleet.stop(), pagasae.stop()]);
});

/** A call of the gateway's API as a person's page makes it: their browser's shared sign-in, the fleet in view. */
function asPerson(browser: string, request: { procedure: string; input: unknown; isQuery?: boolean }): Promise<Response> {
  const headers = { cookie: `aeolus_account_session=${browser}`, [FLEET_HEADER]: fleetId };
  return request.isQuery === true
    ? fetch(`${address}/trpc/${request.procedure}?input=${encodeURIComponent(JSON.stringify(request.input))}`, { headers })
    : fetch(`${address}/trpc/${request.procedure}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(request.input) });
}

const startedSchema = z.object({ result: z.object({ data: z.object({ url: z.string() }) }) });

/** Presses Sign in on Attio's page in one browser: the address Attio's authorize step sends it back to, at the gateway. */
async function signInStarted(browser: string): Promise<URL> {
  const response = await asPerson(browser, { procedure: 'parties.startSignIn', input: { name: 'attio' } });
  expect(response.status, await response.clone().text()).toBe(200);
  const authorized = await fetch(startedSchema.parse(await response.json()).result.data.url, { redirect: 'manual' });
  expect(authorized.status).toBe(302);
  const back = new URL(authorized.headers.get('location') ?? '');
  expect(`${back.origin}${back.pathname}`).toBe(`${PUBLIC_URL}/outside-parties/sign-in/done`);
  return back;
}

/** The gateway's answer to the browser coming back: where it sends the browser next. */
async function cameBack(back: URL, browser: string): Promise<URL> {
  const response = await fetch(`${address}${back.pathname}${back.search}`, { headers: { cookie: `aeolus_account_session=${browser}` }, redirect: 'manual' });
  expect(response.status).toBe(302);
  return new URL(response.headers.get('location') ?? '', PUBLIC_URL);
}

async function signedIn(browser: string): Promise<URL> {
  return cameBack(await signInStarted(browser), browser);
}

const ownSchema = z.object({
  result: z.object({ data: z.object({ state: z.string(), outsideAccount: z.object({ subject: z.string().nullable(), name: z.string().nullable() }).optional(), lastUsedAt: z.string().nullable().optional() }) }),
});

async function ownSignIn(browser: string) {
  const response = await asPerson(browser, { procedure: 'parties.ownSignIn', input: { name: 'attio' }, isQuery: true });
  expect(response.status, await response.clone().text()).toBe(200);
  return ownSchema.parse(await response.json()).result.data;
}

async function keptGrants() {
  const prisma = createPrismaClient(databaseUrl);
  try {
    return await prisma.partyGrant.findMany({ orderBy: { personShipId: 'asc' } });
  } finally {
    await prisma.$disconnect();
  }
}

/** The attio proxy ship as a ship of the fleet discovers it. */
async function discoveredAttio() {
  const reader = await commission(fleet, { cookie, ship: { name: 'reader', type: 'agent', scopes: ['messages:send'] } });
  const response = await fetch(`${fleet.url}/api/v1/ship/discover`, { headers: { authorization: `Bearer ${await register(fleet, reader)}` } });
  return discoverOutputSchema.parse(await response.json()).ships.find(({ name }) => name === 'attio');
}

describe('a person signs in to an outside MCP server for themselves', () => {
  it('keeps their grant with their outside account, and their page shows them signed in (scenario 6)', async () => {
    await started();

    const next = await signedIn(MATHILDE_BROWSER);

    expect({ page: next.pathname, ...Object.fromEntries(next.searchParams) }).toEqual({ page: '/outside-parties/attio', fleet: fleetId, 'sign-in': 'signed-in' });
    await expect(ownSignIn(MATHILDE_BROWSER)).resolves.toMatchObject({ state: 'signedIn', outsideAccount: { subject: 'attio-member-mathilde', name: 'mathilde@acme.example' }, lastUsedAt: null });
    expect(await keptGrants()).toMatchObject([{ personShipId: mathilde, accountId: 'acc-mathilde', subject: 'attio-member-mathilde', accessToken: 'attio-access-2', refreshToken: 'attio-refresh-2' }]);
  });

  it("states the proxy ship from the approver's first grant, with the issuer as its verified fact (scenario 4)", async () => {
    await started();

    await signedIn(MATHILDE_BROWSER);

    const ship = await discoveredAttio();
    expect(z.object({ capabilities: z.array(z.object({ name: z.string() })) }).parse(ship?.statement).capabilities.map(({ name }) => name)).toEqual(['search_records']);
    // The double answers over plain HTTP, so no TLS host is checked: only the issuer of the party's client is written.
    expect(ship?.verified).toMatchObject([{ checked: 'oauthSubject', issuer: attio.issuer, value: 'attio-client-1' }]);
    expect(attio.authorizations.every((authorization) => authorization === 'Bearer attio-access-2')).toBe(true);
  });

  it("never redeems the code of a sign-in another person's browser started, saying why (scenario 7)", async () => {
    await started();
    const back = await signInStarted(MATHILDE_BROWSER);

    const next = await cameBack(back, JORIS_BROWSER);

    expect({ page: next.pathname, outcome: next.searchParams.get('sign-in') }).toEqual({ page: '/outside-parties/attio', outcome: 'failed' });
    expect(await keptGrants()).toEqual([]);
  });

  it("turns away a second person signing in as the outside account another person's grant names, leaving it untouched (scenario 8)", async () => {
    await started();
    await signedIn(MATHILDE_BROWSER);

    const next = await signedIn(JORIS_BROWSER);

    expect(next.searchParams.get('sign-in')).toBe('turned-away');
    await expect(ownSignIn(JORIS_BROWSER)).resolves.toEqual({ state: 'notSignedIn' });
    expect(await keptGrants()).toMatchObject([{ personShipId: mathilde, accessToken: 'attio-access-2' }]);
  });

  it('replaces the grant a person held when they sign in again (scenario 9)', async () => {
    await started();
    await signedIn(MATHILDE_BROWSER);

    await signedIn(MATHILDE_BROWSER);

    expect(await keptGrants()).toMatchObject([{ personShipId: mathilde, accessToken: 'attio-access-4', refreshToken: 'attio-refresh-4' }]);
  });

  it('says a person who denied consent is not signed in, keeping nothing (scenario 10)', async () => {
    await started();
    attio.signIn = 'denied';

    const next = await signedIn(MATHILDE_BROWSER);

    expect({ outcome: next.searchParams.get('sign-in'), error: next.searchParams.get('error') }).toEqual({ outcome: 'not-signed-in', error: 'access_denied' });
    expect(await keptGrants()).toEqual([]);
  });

  it('checks the issuer the authorization response names where the server states it (RFC 9207)', async () => {
    await started({ isIssuerInResponse: true });

    const next = await signedIn(MATHILDE_BROWSER);

    expect(next.searchParams.get('sign-in')).toBe('signed-in');
  });

  it('revokes and drops the grant a person removes, leaving their page not signed in (scenario 24)', async () => {
    await started({ isRevoking: true });
    await signedIn(MATHILDE_BROWSER);

    const removed = await asPerson(MATHILDE_BROWSER, { procedure: 'parties.removeOwnSignIn', input: { name: 'attio' } });

    expect(removed.status, await removed.clone().text()).toBe(200);
    expect(z.object({ result: z.object({ data: z.object({ isRevoked: z.boolean() }) }) }).parse(await removed.json()).result.data).toEqual({ isRevoked: true });
    expect(attio.revoked).toEqual(['attio-refresh-2', 'attio-access-2']);
    await expect(ownSignIn(MATHILDE_BROWSER)).resolves.toEqual({ state: 'notSignedIn' });
    expect(await keptGrants()).toEqual([]);
  });
});
