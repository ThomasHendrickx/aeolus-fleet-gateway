import { idSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaPartyStore } from '../src/adapters/prisma/party-store.js';
import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { startAttioDouble, type AttioDouble, type AttioDoubleOptions } from './fixtures/attio-double/attio-double.js';
import { commission, register, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';
import { connectGateway, mutate, query } from './support/gateway-api.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';
import { outsidePartiesOn } from './support/outside-parties.js';

// Adding an outside MCP server that takes only an OAuth sign-in (decision
// 0067, oauth-servers S2), against an authorization server double shaped as
// Attio's: the gateway finds its authorization server, checks it, registers
// one client per party and commissions the proxy ship, unstated until a
// person signs in.

const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify'];
const PUBLIC_URL = 'https://gateway.example.com';

let fleet: FleetServer;
let attio: AttioDouble;
let cookie: string;
let databaseUrl: string;
let fleetId: FleetId;
let owner: ShipId;
let address: string;
let app: GatewayApp;

async function started(options: AttioDoubleOptions = {}): Promise<void> {
  attio = await startAttioDouble(options);
  app = createGatewayApp({ gatewaySecret: TEST_GATEWAY_SECRET, databaseUrl, fleetUrl: fleet.url, logger: false, publicUrl: PUBLIC_URL });
  address = await app.server.listen({ host: '127.0.0.1', port: 0 });
  const gatewayShip = await commission(fleet, { cookie, ship: { name: 'gateway', type: 'gateway', kind: 'app', scopes: GATEWAY_SCOPES } });
  expect((await connectGateway(address, { cookie, ...gatewayShip })).status).toBe(200);
}

beforeEach(async () => {
  [fleet, databaseUrl] = await Promise.all([startFleetServer(inject('postgresUrl')), migratedDatabase(inject('postgresUrl'))]);
  cookie = await signIn(fleet);
  owner = (await commission(fleet, { cookie, ship: { name: 'mathilde', type: 'person', kind: 'person' } })).shipId;
  const agent = await commission(fleet, { cookie, ship: { name: 'agent', type: 'agent' } });
  const whoami = await fetch(`${fleet.url}/api/v1/ship/whoami`, { headers: { authorization: `Bearer ${await register(fleet, agent)}` } });
  fleetId = z.object({ fleetId: idSchema('fleet') }).parse(await whoami.json()).fleetId;
  await outsidePartiesOn(databaseUrl, fleetId);
});

afterEach(async () => {
  await app.close();
  await Promise.all([attio.close(), fleet.stop()]);
});

function adding(name: string) {
  return mutate(address, { procedure: 'parties.approve', cookie, body: { requestId: `add-${name}`, name, url: attio.url, credential: { kind: 'personSignIn' }, ownerShipId: owner } });
}

async function keptParties() {
  return createPrismaPartyStore(createPrismaClient(databaseUrl)).list(fleetId);
}

const refusalSchema = z.object({ error: z.object({ message: z.string() }) });

describe('an approver adds an outside MCP server where each person signs in', () => {
  it('registers one client for the party, keeps it bound to its issuer and commissions the proxy ship (scenario 1)', async () => {
    await started();

    const response = await adding('attio');

    expect(response.status, await response.clone().text()).toBe(200);
    const party = z.object({ result: z.object({ data: z.object({ name: z.string(), credentialKind: z.string(), state: z.string(), proxyShipId: idSchema('ship') }) }) }).parse(await response.json()).result.data;
    expect({ ...party, proxyShipId: 'set' }).toEqual({ name: 'attio', credentialKind: 'personSignIn', state: 'crewed', proxyShipId: 'set' });
    expect(attio.registered).toEqual([{ clientId: 'attio-client-1', clientName: 'Aeolus: attio', redirectUris: [`${PUBLIC_URL}/outside-parties/sign-in/done`], scope: 'mcp offline_access openid' }]);
    expect(await keptParties()).toMatchObject([
      {
        name: 'attio',
        credential: { kind: 'personSignIn', client: { issuer: attio.issuer, clientId: 'attio-client-1', clientSecret: 'attio-client-1-secret', tokenEndpoint: `${attio.issuer}/oidc/token`, resource: attio.url, scope: 'mcp offline_access openid' } },
      },
    ]);
  });

  it('is refused naming PKCE S256 when the authorization server does not state it, and nothing is kept (scenario 2)', async () => {
    await started({ codeChallengeMethods: ['plain'] });

    const response = await adding('attio');

    expect(response.status).toBe(400);
    expect(refusalSchema.parse(await response.json()).error.message).toContain('PKCE S256');
    expect({ registered: attio.registered, parties: await keptParties() }).toEqual({ registered: [], parties: [] });
  });

  it('is refused saying so when the server offers no dynamic registration, and nothing is kept (scenario 3)', async () => {
    await started({ isRegistering: false });

    const response = await adding('attio');

    expect(response.status).toBe(400);
    expect(refusalSchema.parse(await response.json()).error.message).toContain('offers no dynamic registration');
    expect(await keptParties()).toEqual([]);
  });

  it("keeps a client of each party's own, and retiring one leaves the other's (scenario 5)", async () => {
    await started();
    expect((await adding('attio')).status).toBe(200);
    expect((await adding('attio-sales')).status).toBe(200);

    const manager = await commission(fleet, { cookie, ship: { name: 'manager', type: 'agent', scopes: ['fleet:manage'] } });

    const retired = await mutate(address, { procedure: 'parties.retire', crewToken: await register(fleet, manager), body: { name: 'attio' } });

    expect(retired.status, await retired.clone().text()).toBe(200);
    expect(attio.registered.map((client) => client.clientId)).toEqual(['attio-client-1', 'attio-client-2']);
    expect(await keptParties()).toMatchObject([{ name: 'attio-sales', credential: { kind: 'personSignIn', client: { clientId: 'attio-client-2' } } }]);
  });

  it('lists the party as one where each person signs in', async () => {
    await started();
    expect((await adding('attio')).status).toBe(200);

    const listed = await query(address, { procedure: 'parties.list', cookie });

    expect(z.object({ result: z.object({ data: z.array(z.object({ name: z.string(), credentialKind: z.string() })) }) }).parse(await listed.json()).result.data).toMatchObject([{ name: 'attio', credentialKind: 'personSignIn' }]);
  });
});
