import type { ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { commission, registerNetworkingPlugin, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';
import { connectGateway, mutate, query } from './support/gateway-api.js';

// The gateway against a real core: it starts not connected, with no secret
// anywhere; argo connects it as its ship, it keeps the crew token in its own
// database and is connected again after a restart. It serves only a fleet with
// a registered networking plugin (interop I-3).

const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'labels:assign'];
const INSTALLATION_TOKEN = 'an-installation-token-of-at-least-32-characters';

let fleet: FleetServer;
let cookie: string;
let gatewayShip: { shipId: ShipId; secret: string };
let databaseUrl: string;
const apps: GatewayApp[] = [];

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  cookie = await signIn(fleet);
  gatewayShip = await commission(fleet, { cookie, ship: { name: 'gateway', type: 'gateway', scopes: GATEWAY_SCOPES } });
  databaseUrl = await migratedDatabase(inject('postgresUrl'));
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await fleet.stop();
});

/** A gateway process on the test's database, serving on a free port; with an installation token, a fleet is served once switched on. */
async function started(installationToken?: string): Promise<string> {
  const app = createGatewayApp({ databaseUrl, fleetUrl: fleet.url, logger: false, ...(installationToken === undefined ? {} : { installationToken }) });
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

  it('is refused in a fleet with no networking plugin, and stays not connected (interop I-3)', async () => {
    const address = await started();

    const response = await connectGateway(address, { cookie, ...gatewayShip });

    await expect(refusalOf(response)).resolves.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(status(address)).resolves.toMatchObject({ state: 'not-connected' });
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

  it('refuses to switch on a connected fleet whose networking plugin is gone (interop I-3)', async () => {
    await registerNetworkingPlugin(fleet, cookie);
    const address = await started(INSTALLATION_TOKEN);
    const id = await fleetId();
    await mutate(address, { procedure: 'installation.setEnabled', installationToken: INSTALLATION_TOKEN, body: { requestId: 'r-1', fleetId: id, enabled: true } });
    await connectGateway(address, { cookie, ...gatewayShip });
    await mutate(address, { procedure: 'installation.setEnabled', installationToken: INSTALLATION_TOKEN, body: { requestId: 'r-2', fleetId: id, enabled: false } });
    await fetch(`${fleet.url}/trpc/fleet.retire`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: fleet.url, cookie },
      body: JSON.stringify({ shipId: await networkingPluginShipId() }),
    });

    const refused = await mutate(address, { procedure: 'installation.setEnabled', installationToken: INSTALLATION_TOKEN, body: { requestId: 'r-3', fleetId: id, enabled: true } });

    await expect(refusalOf(refused)).resolves.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('refuses the installation procedures without the installation token', async () => {
    const address = await started(INSTALLATION_TOKEN);

    const refused = await mutate(address, { procedure: 'installation.setEnabled', body: { requestId: 'r-1', fleetId: await fleetId(), enabled: true } });

    expect(refused.status).toBe(401);
  });
});

async function networkingPluginShipId(): Promise<string> {
  const response = await fetch(`${fleet.url}/trpc/fleet.list`, { headers: { cookie } });
  const ships = z.object({ result: z.object({ data: z.array(z.object({ id: z.string(), type: z.string() })) }) }).parse(await response.json()).result.data;
  return z.string().parse(ships.find((ship) => ship.type === 'networking-plugin')?.id);
}
