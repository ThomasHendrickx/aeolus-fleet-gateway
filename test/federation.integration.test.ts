import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createProviderDiscovery } from '../src/adapters/oidc/provider-discovery.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaIdentityProviders } from '../src/adapters/prisma/identity-providers.js';
import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { aFreePort, startFleetServer, type FleetServer } from './support/fleet-server.js';
import { mutate, query } from './support/gateway-api.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';
import { startOidcProvider, type OidcProvider } from './support/oidc-provider.js';

// Federation for people (interop I-4): argo sets the fleet's company identity
// provider, which a local OpenID provider stands in for here.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const AT = new Date('2026-10-19T12:00:00.000Z');

let provider: OidcProvider;

beforeAll(async () => {
  provider = await startOidcProvider();
});

afterAll(async () => {
  await provider.stop();
});

describe("the gateway reads an identity provider's OpenID configuration", () => {
  const discovery = createProviderDiscovery({ timeoutMs: 5000 });

  it('reads its issuer, authorization and token endpoints, and keys', async () => {
    const issuer = provider.issuerOf('company');

    await expect(discovery.discover(issuer)).resolves.toEqual({
      isOk: true,
      value: { issuer, authorizationEndpoint: `${issuer}/authorize`, tokenEndpoint: `${issuer}/token`, jwksUri: `${issuer}/jwks` },
    });
  });

  it('cannot read one where nothing answers, saying why', async () => {
    const discovered = await discovery.discover(`http://127.0.0.1:${String(await aFreePort())}/company`);

    expect(discovered.isOk ? '' : discovered.error.reason).not.toBe('');
  });
});

describe("the fleets' identity providers in Postgres", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps one per fleet, the last argo set, with its secret", async () => {
    const providers = createPrismaIdentityProviders(prisma);
    await providers.save({ fleetId: FLEET, issuer: 'https://accounts.google.com', clientId: 'old', clientSecret: 'old-secret', setAt: AT });

    await providers.save({ fleetId: FLEET, issuer: 'https://accounts.google.com', clientId: 'gateway', clientSecret: 'google-secret', setAt: AT });

    await expect(Promise.all([providers.find(FLEET), providers.find(OTHER_FLEET)])).resolves.toEqual([
      { fleetId: FLEET, issuer: 'https://accounts.google.com', clientId: 'gateway', clientSecret: 'google-secret', setAt: AT },
      undefined,
    ]);
  });

  it('forgets a fleet with its identity provider (decision 0021)', async () => {
    const providers = createPrismaIdentityProviders(prisma);
    await providers.save({ fleetId: OTHER_FLEET, issuer: 'https://accounts.google.com', clientId: 'gateway', clientSecret: 's', setAt: AT });

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    await expect(providers.find(OTHER_FLEET)).resolves.toBeUndefined();
  });
});

describe("argo sets the fleet's identity provider through the gateway's API", () => {
  let fleet: FleetServer;
  let app: GatewayApp;
  let address: string;
  let cookie: string;

  beforeEach(async () => {
    fleet = await startFleetServer(inject('postgresUrl'));
    cookie = await signIn(fleet);
    app = createGatewayApp({ databaseUrl: await migratedDatabase(inject('postgresUrl')), fleetUrl: fleet.url, logger: false, gatewaySecret: TEST_GATEWAY_SECRET });
    address = await app.server.listen({ host: '127.0.0.1', port: 0 });
  });

  afterEach(async () => {
    await app.close();
    await fleet.stop();
  });

  const shown = z.object({ result: z.object({ data: z.unknown() }) });

  it('sets it, and reads it back without its secret', async () => {
    const issuer = provider.issuerOf('company');

    const set = await mutate(address, { procedure: 'identityProvider.set', cookie, body: { issuer, clientId: 'gateway', clientSecret: 'company-secret' } });
    const read = await query(address, { procedure: 'identityProvider.get', cookie });

    expect(set.status).toBe(200);
    const body = await read.text();
    expect(shown.parse(JSON.parse(body)).result.data).toMatchObject({ issuer, clientId: 'gateway' });
    expect(body).not.toContain('company-secret');
  });

  it('refuses one whose OpenID configuration it cannot read', async () => {
    const set = await mutate(address, { procedure: 'identityProvider.set', cookie, body: { issuer: `http://127.0.0.1:${String(await aFreePort())}/company`, clientId: 'gateway', clientSecret: 's' } });

    expect(set.status).toBe(400);
    await expect(query(address, { procedure: 'identityProvider.get', cookie }).then(async (response) => shown.parse(await response.json()).result.data)).resolves.toBeNull();
  });
});
