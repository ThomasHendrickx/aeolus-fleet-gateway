import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';

// The Overview page served by the gateway, with a real console session.

let fleet: FleetServer;
let app: GatewayApp;
let address: string;
let cookie: string;

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  cookie = await signIn(fleet);
  app = createGatewayApp({ gatewaySecret: TEST_GATEWAY_SECRET, databaseUrl: await migratedDatabase(inject('postgresUrl')), fleetUrl: fleet.url, logger: false });
  address = await app.server.listen({ host: '127.0.0.1', port: 0 });
});

afterEach(async () => {
  await app.close();
  await fleet.stop();
});

describe('the Overview page', () => {
  it('shows argo what waits on them', async () => {
    const page = await fetch(`${address}/overview`, { headers: { cookie } });

    expect(page.status).toBe(200);
    await expect(page.text()).resolves.toContain('<title>Overview</title>');
  });

  it('says a request that is not to decide no longer waits', async () => {
    const page = await fetch(`${address}/overview/requests/req_gone`, { headers: { cookie } });

    expect(page.status).toBe(404);
    await expect(page.text()).resolves.toContain('no longer waits');
  });

  it('sends a caller without a session to the console', async () => {
    const page = await fetch(`${address}/overview`);

    expect(page.status).toBe(401);
    await expect(page.text()).resolves.toContain(`href="${fleet.url}"`);
  });
});
