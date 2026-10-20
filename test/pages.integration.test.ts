import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import WebSocket from 'ws';

import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';

// The gateway's pages are accounts only (Thomas, 20 Oct): argo's console
// session is no way in, as argo works with the gateway from the console,
// server to server (decision 0043). Here no pagasae is set, so the pages
// sign no one in.

const PAGES = ['/overview', '/overview/requests/req_1', '/outside-parties', '/parties'];

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
  it("refuses argo's console session on every page, saying this gateway signs no one in", async () => {
    const answers = await Promise.all(PAGES.map((page) => fetch(`${address}${page}`, { headers: { cookie } })));

    expect(await Promise.all(answers.map(async (answer) => ({ status: answer.status, says: (await answer.text()).includes('signs no one in') })))).toEqual(PAGES.map(() => ({ status: 401, says: true })));
  });

  it("refuses argo's console session a form, changing nothing", async () => {
    const answer = await fetch(`${address}/outside-parties/switch`, { method: 'POST', headers: { cookie, origin: address, 'content-type': 'application/x-www-form-urlencoded' }, body: 'isOn=true' });

    expect(answer.status).toBe(401);
  });

  it("closes a live socket opened with argo's console session", async () => {
    let code: number | undefined;
    const socket = new WebSocket(`${address.replace('http', 'ws')}/live?page=overview`, { headers: { cookie, origin: address } });
    socket.on('close', (closed: number) => {
      code = closed;
    });
    const deadline = Date.now() + 5000;
    while (code === undefined && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(code).toBe(4401);
  });

  it("still serves argo's console session the API, server to server", async () => {
    const answer = await fetch(`${address}/trpc/outsideParties.status`, { headers: { cookie } });

    expect(answer.status).not.toBe(401);
  });
});
