import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';

// The gateway's pages are accounts only (Thomas, 20 Oct): argo's console
// session is no way in, as argo works with the gateway from the console,
// server to server (decision 0043). Here no pagasae is set, so the pages
// sign no one in.

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

describe("the gateway's pages, for accounts only", () => {
  it("still serves argo's console session the API, server to server", async () => {
    const answer = await fetch(`${address}/trpc/outsideParties.status`, { headers: { cookie } });

    expect(answer.status).not.toBe(401);
  });
});
