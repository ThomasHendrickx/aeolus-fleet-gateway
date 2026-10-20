import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import WebSocket from 'ws';

import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { migratedDatabase } from './support/database.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';

// The live channel through the whole gateway. A person's overview following
// a request is in sign-in.integration.test.ts, where pagasae signs them in.

const HEARD_WITHIN_MS = 5000;

let fleet: FleetServer;
let app: GatewayApp;
let address: string;
let socket: WebSocket | undefined;

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  app = createGatewayApp({ gatewaySecret: TEST_GATEWAY_SECRET, databaseUrl: await migratedDatabase(inject('postgresUrl')), fleetUrl: fleet.url, logger: false });
  address = await app.server.listen({ host: '127.0.0.1', port: 0 });
});

afterEach(async () => {
  socket?.terminate();
  await app.close();
  await fleet.stop();
});

async function until(isDone: () => boolean): Promise<void> {
  const deadline = Date.now() + HEARD_WITHIN_MS;
  while (!isDone()) {
    if (Date.now() > deadline) {
      throw new Error('not heard in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("the pages' live channel", () => {
  it('closes a socket with no session', async () => {
    let code: number | undefined;
    socket = new WebSocket(`${address.replace('http', 'ws')}/live?page=overview`, { headers: { origin: address } });
    socket.on('close', (closed: number) => {
      code = closed;
    });

    await until(() => code !== undefined);
    expect(code).toBe(4401);
  });
});
