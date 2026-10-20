import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import WebSocket from 'ws';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaPendingRequests } from '../src/adapters/prisma/pending-requests.js';
import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { commission, register, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';

// The live channel through the whole gateway: argo's overview, open in a
// browser, is sent its sections again when a request opens in argo's fleet.

const HEARD_WITHIN_MS = 5000;

let fleet: FleetServer;
let app: GatewayApp;
let prisma: PrismaClient;
let address: string;
let cookie: string;
let fleetId: `flt_${string}`;
let socket: WebSocket | undefined;

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  cookie = await signIn(fleet);
  const databaseUrl = await migratedDatabase(inject('postgresUrl'));
  app = createGatewayApp({ gatewaySecret: TEST_GATEWAY_SECRET, databaseUrl, fleetUrl: fleet.url, logger: false });
  address = await app.server.listen({ host: '127.0.0.1', port: 0 });
  prisma = createPrismaClient(databaseUrl);
  const ship = await register(fleet, await commission(fleet, { cookie, ship: { name: 'reader', type: 'agent', scopes: ['fleet:read'] } }));
  const whoami = await fetch(`${fleet.url}/api/v1/ship/whoami`, { headers: { authorization: `Bearer ${ship}` } });
  fleetId = z.object({ fleetId: z.templateLiteral(['flt_', z.string()]) }).parse(await whoami.json()).fleetId;
});

afterEach(async () => {
  socket?.terminate();
  await prisma.$disconnect();
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
  it("sends argo's overview again when a request opens in argo's fleet", async () => {
    const received: string[] = [];
    socket = new WebSocket(`${address.replace('http', 'ws')}/live?page=overview`, { headers: { cookie, origin: address } });
    socket.on('message', (data: Buffer) => received.push(data.toString()));
    await until(() => received.length === 1);

    const now = new Date();
    await createPrismaPendingRequests(prisma).open({
      fleetId,
      requestId: 'req_01m5c7hmbt9f1vrkwb37az0001',
      subject: { kind: 'client', clientId: 'https://orderbot.example.com/client.json', clientName: 'Orderbot' },
      requesters: [{ accountId: 'acc-charlotte', personShipId: null }],
      askedAt: now,
      expiresAt: new Date(now.getTime() + 7 * 86_400_000),
      state: 'pending',
      decidedBy: null,
      decidedAt: null,
      now,
    });

    await until(() => received.length === 2);
    expect(z.object({ sections: z.object({ overview: z.string() }) }).safeParse(JSON.parse(received[1] ?? '')).success).toBe(true);
  });

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
