import type { ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { commission, register, registerNetworkingPlugin, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';
import { connectGateway, mutate, query } from './support/gateway-api.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';

// The gateway against a real core: it starts not connected, with no secret
// anywhere; argo connects it as its ship, it keeps the crew token in its own
// database and is connected again after a restart, whatever network the
// fleet has (interop I-3, Thomas 20 Oct).

const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare'];
const INSTALLATION_TOKEN = 'an-installation-token-of-at-least-32-characters';

let fleet: FleetServer;
let cookie: string;
let gatewayShip: { shipId: ShipId; secret: string };
let databaseUrl: string;
const apps: GatewayApp[] = [];

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  cookie = await signIn(fleet);
  gatewayShip = await commission(fleet, { cookie, ship: { name: 'gateway', type: 'gateway', kind: 'app', scopes: GATEWAY_SCOPES } });
  databaseUrl = await migratedDatabase(inject('postgresUrl'));
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await fleet.stop();
});

/** A gateway process on the test's database, serving on a free port; with an installation token, a fleet is served once switched on. */
async function started(installationToken?: string): Promise<string> {
  const app = createGatewayApp({ gatewaySecret: TEST_GATEWAY_SECRET, databaseUrl, fleetUrl: fleet.url, logger: false, ...(installationToken === undefined ? {} : { installationToken }) });
  apps.push(app);
  await app.restoreConnections();
  return app.server.listen({ host: '127.0.0.1', port: 0 });
}

const statusSchema = z.object({
  result: z.object({ data: z.object({ enabled: z.boolean(), state: z.string(), ship: z.object({ shipId: z.string(), name: z.string() }).nullable(), lastShipId: z.string().nullable() }) }),
});

async function status(address: string) {
  return statusSchema.parse(await (await query(address, { procedure: 'connection.status', cookie })).json()).result.data;
}

const errorSchema = z.object({ error: z.object({ message: z.string(), data: z.object({ code: z.string() }) }) });

async function refusalOf(response: Response) {
  const { error } = errorSchema.parse(await response.json());
  return { code: error.data.code, message: error.message };
}

describe('a gateway that was never connected', () => {
  it('starts not connected', async () => {
    const address = await started();

    await expect(status(address)).resolves.toEqual({ enabled: true, state: 'not-connected', ship: null, lastShipId: null });
  });

  it('refuses a caller without a console session', async () => {
    const address = await started();

    const response = await query(address, { procedure: 'connection.status' });
    expect(response.status).toBe(401);
  });
});

describe('argo connects the gateway', () => {
  it('in a fleet with a networking plugin: the gateway registers its ship and is connected as it', async () => {
    await registerNetworkingPlugin(fleet, cookie);
    const address = await started();

    const response = await connectGateway(address, { cookie, ...gatewayShip });

    expect(response.status, await response.clone().text()).toBe(200);
    await expect(status(address)).resolves.toEqual({ enabled: true, state: 'connected', ship: { shipId: gatewayShip.shipId, name: 'gateway' }, lastShipId: gatewayShip.shipId });
  });

  it("declares its approving scope in the fleet, gateway:approve, declared by the gateway's ship (decision 0056)", async () => {
    await registerNetworkingPlugin(fleet, cookie);
    const address = await started();
    await connectGateway(address, { cookie, ...gatewayShip });
    const reader = await register(fleet, await commission(fleet, { cookie, ship: { name: 'reader', type: 'agent', scopes: ['fleet:read'] } }));

    const answer = await fetch(`${fleet.url}/api/v1/fleet/scopes`, { headers: { authorization: `Bearer ${reader}` } });

    const namespaces = z.array(z.object({ namespace: z.string(), declaredBy: z.object({ name: z.string() }).nullable(), scopes: z.array(z.object({ scope: z.string() })) })).parse(await answer.json());
    expect(namespaces.find(({ namespace }) => namespace === 'gateway')).toEqual({ namespace: 'gateway', declaredBy: { name: 'gateway' }, scopes: [{ scope: 'gateway:approve' }] });
  });

  it("serves a ship by its own crew token, with the scopes the fleet holds for it (decision 0057)", async () => {
    await registerNetworkingPlugin(fleet, cookie);
    const address = await started();
    await connectGateway(address, { cookie, ...gatewayShip });
    const reader = await register(fleet, await commission(fleet, { cookie, ship: { name: 'reader', type: 'agent', scopes: ['fleet:read'] } }));

    const [read, changed, forged] = await Promise.all([
      query(address, { procedure: 'parties.list', crewToken: reader }),
      mutate(address, { procedure: 'parties.crew', crewToken: reader, body: { name: 'crm' } }),
      query(address, { procedure: 'parties.list', crewToken: 'aeolus_ct_v1_forged' }),
    ]);

    expect([read.status, changed.status, forged.status]).toEqual([200, 403, 401]);
  });

  it('connects in a fleet with no networking plugin: the fleet decides its network (interop I-3, Thomas 20 Oct)', async () => {
    const address = await started();

    const response = await connectGateway(address, { cookie, ...gatewayShip });

    expect(response.status, await response.clone().text()).toBe(200);
    await expect(status(address)).resolves.toMatchObject({ state: 'connected' });
  });

  it('is refused for a ship without the gateway scopes', async () => {
    await registerNetworkingPlugin(fleet, cookie);
    const reader = await commission(fleet, { cookie, ship: { name: 'reader', type: 'gateway', scopes: ['fleet:read'] } });
    const address = await started();

    const response = await connectGateway(address, { cookie, ...reader });

    await expect(refusalOf(response)).resolves.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('is connected again after a restart with the kept crew token', async () => {
    await registerNetworkingPlugin(fleet, cookie);
    await connectGateway(await started(), { cookie, ...gatewayShip });
    await Promise.all(apps.splice(0).map((app) => app.close()));

    const address = await started();

    await expect(status(address)).resolves.toMatchObject({ state: 'connected', ship: { shipId: gatewayShip.shipId } });
  });
});

describe('the hosting service switches the gateway per fleet (decision 0021)', () => {
  async function fleetId(): Promise<string> {
    const response = await fetch(`${fleet.url}/trpc/console.session`, { headers: { cookie } });
    return z.object({ result: z.object({ data: z.object({ fleetId: z.string() }) }) }).parse(await response.json()).result.data.fleetId;
  }

  it('serves a fleet only once switched on', async () => {
    const address = await started(INSTALLATION_TOKEN);
    await expect(status(address)).resolves.toMatchObject({ enabled: false });

    const switched = await mutate(address, { procedure: 'installation.setEnabled', installationToken: INSTALLATION_TOKEN, body: { requestId: 'r-1', fleetId: await fleetId(), enabled: true } });

    expect(switched.status, await switched.clone().text()).toBe(200);
    await expect(status(address)).resolves.toMatchObject({ enabled: true });
  });

  it('switches on a connected fleet with no networking plugin (interop I-3, Thomas 20 Oct)', async () => {
    const address = await started(INSTALLATION_TOKEN);
    const id = await fleetId();
    await mutate(address, { procedure: 'installation.setEnabled', installationToken: INSTALLATION_TOKEN, body: { requestId: 'r-1', fleetId: id, enabled: true } });
    await connectGateway(address, { cookie, ...gatewayShip });
    await mutate(address, { procedure: 'installation.setEnabled', installationToken: INSTALLATION_TOKEN, body: { requestId: 'r-2', fleetId: id, enabled: false } });

    const switched = await mutate(address, { procedure: 'installation.setEnabled', installationToken: INSTALLATION_TOKEN, body: { requestId: 'r-3', fleetId: id, enabled: true } });

    expect(switched.status, await switched.clone().text()).toBe(200);
  });

  it('refuses the installation procedures without the installation token', async () => {
    const address = await started(INSTALLATION_TOKEN);

    const refused = await mutate(address, { procedure: 'installation.setEnabled', body: { requestId: 'r-1', fleetId: await fleetId(), enabled: true } });

    expect(refused.status).toBe(401);
  });
});

