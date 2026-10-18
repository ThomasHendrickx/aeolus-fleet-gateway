import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';

// The gateway's page with a real console session: argo signs in to the
// console, and the gateway's page knows argo by the forwarded cookie.

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

describe("the gateway's page of parties", () => {
  it('shows argo the form to approve a party', async () => {
    const page = await fetch(`${address}/parties`, { headers: { cookie } });

    expect(page.status).toBe(200);
    await expect(page.text()).resolves.toContain('Approve an MCP server');
  });

  it("says why an approval was refused: the gateway is not connected to argo's fleet yet", async () => {
    const form = new URLSearchParams({ requestId: 'r-1', name: 'crm', url: 'https://crm.example.com/mcp', credentialKind: 'bearer', token: 't', ownerShipId: 'shp_01m3tbfspe96yf1rnr4ank9wnr', concurrencyLimit: '4' });

    const answer = await fetch(`${address}/parties/approve`, { method: 'POST', headers: { cookie, origin: address, 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });

    expect(answer.status).toBe(412);
  });

  it('sends a caller without a session to the console', async () => {
    const page = await fetch(`${address}/parties`);

    expect(page.status).toBe(401);
    await expect(page.text()).resolves.toContain(`href="${fleet.url}"`);
  });
});
