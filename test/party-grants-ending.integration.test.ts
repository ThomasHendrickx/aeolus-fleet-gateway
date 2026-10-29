import { FLEET_HEADER, idSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient } from '../src/adapters/prisma/client.js';
import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { startAttioDouble, type AttioDouble } from './fixtures/attio-double/attio-double.js';
import { applyEmptyOwnRules, commission, register, retire, setOwner, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { charlotteIn, PAGASAE_APP_CLIENT, PAGASAE_CLIENT, startFakePagasae, type FakePagasae } from './support/fake-pagasae.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';
import { connectGateway, mutate, query } from './support/gateway-api.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';
import { outsidePartiesOn } from './support/outside-parties.js';

// Grants ending (decision 0067, oauth-servers S6), against an authorization
// server double shaped as Attio's that offers revocation and client
// deletion: an approver lists and removes any person's grant, within manage
// reach of the proxy ship; a retired person ship, a disabled account and a
// retired party end their grants; a new owner of the proxy ship changes
// none. The gateway, the fleet and the Attio double are real; pagasae is
// its double.

const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify'];
const PUBLIC_URL = 'https://gateway.example.com';
const INSTALLATION_TOKEN = 'an-installation-token-of-at-least-32-characters';
const MATHILDE_BROWSER = 'mathilde-shared-sign-in';
const JORIS_BROWSER = 'joris-shared-sign-in';
/** How often the gateway's grant round runs here: fast enough for a test to wait on. */
const GRANT_ROUND_MS = 100;

let fleet: FleetServer;
let pagasae: FakePagasae;
let attio: AttioDouble;
let cookie: string;
let databaseUrl: string;
let fleetId: FleetId;
let mathilde: ShipId;
let joris: ShipId;
let approver: string;
let proxyShipId: ShipId;
let address: string;
let app: GatewayApp;

beforeEach(async () => {
  [fleet, databaseUrl, pagasae, attio] = await Promise.all([startFleetServer(inject('postgresUrl')), migratedDatabase(inject('postgresUrl')), startFakePagasae(), startAttioDouble({ isRevoking: true, isManagingClients: true })]);
  cookie = await signIn(fleet);
  mathilde = (await commission(fleet, { cookie, ship: { name: 'mathilde', type: 'person', kind: 'person' } })).shipId;
  joris = (await commission(fleet, { cookie, ship: { name: 'joris', type: 'person', kind: 'person' } })).shipId;
  const agent = await register(fleet, await commission(fleet, { cookie, ship: { name: 'agent', type: 'agent' } }));
  const whoami = await fetch(`${fleet.url}/api/v1/ship/whoami`, { headers: { authorization: `Bearer ${agent}` } });
  fleetId = z.object({ fleetId: idSchema('fleet') }).parse(await whoami.json()).fleetId;
  pagasae.sharedSignIn(MATHILDE_BROWSER, { ...charlotteIn(pagasae, fleetId), sub: 'acc-mathilde', scope: 'fleet:read gateway:approve', person_ship: mathilde });
  pagasae.sharedSignIn(JORIS_BROWSER, { ...charlotteIn(pagasae, fleetId), sub: 'acc-joris', person_ship: joris });
  await outsidePartiesOn(databaseUrl, fleetId);
  app = createGatewayApp({
    gatewaySecret: TEST_GATEWAY_SECRET,
    databaseUrl,
    fleetUrl: fleet.url,
    logger: false,
    publicUrl: PUBLIC_URL,
    pagasae: { url: pagasae.url, ...PAGASAE_CLIENT },
    pagasaeApp: PAGASAE_APP_CLIENT,
    installationToken: INSTALLATION_TOKEN,
    grantRoundMs: GRANT_ROUND_MS,
  });
  address = await app.server.listen({ host: '127.0.0.1', port: 0 });
  expect((await mutate(address, { procedure: 'installation.setEnabled', installationToken: INSTALLATION_TOKEN, body: { requestId: 'switch-on', fleetId, enabled: true } })).status).toBe(200);
  const gatewayShip = await commission(fleet, { cookie, ship: { name: 'gateway', type: 'gateway', kind: 'app', scopes: GATEWAY_SCOPES } });
  expect((await connectGateway(address, { cookie, ...gatewayShip })).status).toBe(200);
  // gateway:approve is the gateway's scope, so the fleet lists it once the gateway is connected.
  approver = await register(fleet, await commission(fleet, { cookie, ship: { name: 'approver', type: 'agent', scopes: ['fleet:read', 'gateway:approve'] } }));
  const added = await mutate(address, { procedure: 'parties.approve', cookie, body: { requestId: 'add-attio', name: 'attio', url: attio.url, credential: { kind: 'personSignIn' }, ownerShipId: mathilde } });
  expect(added.status, await added.clone().text()).toBe(200);
  proxyShipId = z.object({ result: z.object({ data: z.object({ proxyShipId: idSchema('ship') }) }) }).parse(await added.json()).result.data.proxyShipId;
  await signedIn(MATHILDE_BROWSER);
  attio.signIn = { subject: 'attio-member-joris', email: 'joris@acme.example' };
  await signedIn(JORIS_BROWSER);
  await app.restoreConnections();
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

/** A person presses Sign in on Attio's page and consents, their browser coming back to the gateway. */
async function signedIn(browser: string): Promise<void> {
  const started = await asPerson(browser, { procedure: 'parties.startSignIn', input: { name: 'attio' } });
  expect(started.status, await started.clone().text()).toBe(200);
  const authorized = await fetch(z.object({ result: z.object({ data: z.object({ url: z.string() }) }) }).parse(await started.json()).result.data.url, { redirect: 'manual' });
  const back = new URL(authorized.headers.get('location') ?? '');
  const response = await fetch(`${address}${back.pathname}${back.search}`, { headers: { cookie: `aeolus_account_session=${browser}` }, redirect: 'manual' });
  expect(new URL(response.headers.get('location') ?? '', PUBLIC_URL).searchParams.get('sign-in')).toBe('signed-in');
}

/** Whose grants the gateway keeps, by person ship. */
async function keptGrants(): Promise<{ personShipId: string; subject: string | null; accessToken: string }[]> {
  const prisma = createPrismaClient(databaseUrl);
  try {
    return await prisma.partyGrant.findMany({ select: { personShipId: true, subject: true, accessToken: true }, orderBy: { personShipId: 'asc' } });
  } finally {
    await prisma.$disconnect();
  }
}

const signInsSchema = z.object({ result: z.object({ data: z.object({ grants: z.array(z.object({ personShipId: z.string(), state: z.string(), outsideAccount: z.object({ subject: z.string().nullable() }) })), next: z.string().nullable() }) }) });

describe("an approver sees and removes everyone's sign-ins (Q6, Q12)", () => {
  it('lists every person signed in, with their outside account, never a token', async () => {
    const listed = await query(address, { procedure: 'parties.signIns', crewToken: approver, input: { name: 'attio', after: null } });

    expect(listed.status, await listed.clone().text()).toBe(200);
    const body: unknown = await listed.clone().json();
    expect(JSON.stringify(body)).not.toContain('attio-access');
    expect(signInsSchema.parse(body).result.data).toEqual({
      grants: [mathilde, joris]
        .sort()
        .map((personShipId) => ({ personShipId, state: 'signedIn', outsideAccount: { subject: personShipId === mathilde ? 'attio-member-mathilde' : 'attio-member-joris' } })),
      next: null,
    });
  });

  it("removes Joris's grant, revoked at Attio, leaving Mathilde's (scenario 25)", async () => {
    const [jorisGrant] = (await keptGrants()).filter(({ personShipId }) => personShipId === joris);

    const removed = await mutate(address, { procedure: 'parties.removeSignIn', crewToken: approver, body: { name: 'attio', personShipId: joris } });

    expect(removed.status, await removed.clone().text()).toBe(200);
    expect(attio.revoked).toContain(jorisGrant?.accessToken);
    expect((await keptGrants()).map(({ personShipId }) => personShipId)).toEqual([mathilde]);
  });

  it("refuses an approver outside the proxy ship's manage reach, removing nothing (scenario 25)", async () => {
    await applyEmptyOwnRules(fleet, cookie);

    const removed = await mutate(address, { procedure: 'parties.removeSignIn', crewToken: approver, body: { name: 'attio', personShipId: joris } });

    expect(removed.status).toBe(403);
    expect(await keptGrants()).toHaveLength(2);
  });

  it('refuses the list to a person without gateway:approve, who still sees their own (scenario 26)', async () => {
    const [listed, own] = await Promise.all([
      asPerson(JORIS_BROWSER, { procedure: 'parties.signIns', input: { name: 'attio', after: null }, isQuery: true }),
      asPerson(JORIS_BROWSER, { procedure: 'parties.ownSignIn', input: { name: 'attio' }, isQuery: true }),
    ]);

    expect({ listed: listed.status, own: own.status }).toEqual({ listed: 403, own: 200 });
  });
});

describe('grants as the fleet changes', () => {
  it("keeps every grant when the proxy ship's owner changes (scenario 28)", async () => {
    const before = await keptGrants();

    await setOwner(fleet, { cookie, shipId: proxyShipId, ownerShipId: joris });

    await new Promise((resolve) => setTimeout(resolve, GRANT_ROUND_MS * 3));
    expect(await keptGrants()).toEqual(before);
  });

  it("ends every grant of Mathilde's retired person ship at the next round, revoked at Attio (scenario 29)", async () => {
    const [mathildeGrant] = (await keptGrants()).filter(({ personShipId }) => personShipId === mathilde);

    await retire(fleet, { cookie, shipId: mathilde });

    await expect.poll(async () => (await keptGrants()).map(({ personShipId }) => personShipId)).toEqual([joris]);
    expect(attio.revoked).toContain(mathildeGrant?.accessToken);
  });

  it("ends every grant of Mathilde's disabled account when pagasae tells the gateway (scenario 30)", async () => {
    const told = await mutate(address, { procedure: 'installation.accountDisabled', installationToken: INSTALLATION_TOKEN, body: { fleetId, accountId: 'acc-mathilde' } });

    expect(told.status, await told.clone().text()).toBe(200);
    expect((await keptGrants()).map(({ personShipId }) => personShipId)).toEqual([joris]);
  });

  it("ends every grant of the retired party and deletes its client at Attio (scenario 31)", async () => {
    const manager = await register(fleet, await commission(fleet, { cookie, ship: { name: 'manager', type: 'agent', scopes: ['fleet:read', 'fleet:manage'] } }));

    const retired = await mutate(address, { procedure: 'parties.retire', crewToken: manager, body: { name: 'attio' } });

    expect(retired.status, await retired.clone().text()).toBe(200);
    expect({ grants: await keptGrants(), revoked: attio.revoked.length, deleted: attio.deletedClients }).toEqual({ grants: [], revoked: 4, deleted: ['attio-client-1'] });
  });
});
