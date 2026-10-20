import type { ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaPendingRequests } from '../src/adapters/prisma/pending-requests.js';
import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { commission, register, registerNetworkingPlugin, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { aFreePort, startFleetServer, type FleetServer } from './support/fleet-server.js';
import { connectGateway, mutate, query } from './support/gateway-api.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';

// An agent ship holding gateway:approve decides a pending request through
// the gateway's API (decision 0056): the gateway, as its own ship,
// commissions and crews the outside client's proxy ship in the real fleet.

const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare'];
const REQUEST_ID = 'req_01m5c7hmbt9f1vrkwb37az0001';

let fleet: FleetServer;
let app: GatewayApp;
let prisma: PrismaClient;
let address: string;
let approver: string;
let owner: ShipId;

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  const cookie = await signIn(fleet);
  const databaseUrl = await migratedDatabase(inject('postgresUrl'));
  const port = await aFreePort();
  address = `http://127.0.0.1:${String(port)}`;
  app = createGatewayApp({ databaseUrl, fleetUrl: fleet.url, logger: false, publicUrl: address, gatewaySecret: TEST_GATEWAY_SECRET });
  await app.server.listen({ host: '127.0.0.1', port });
  await registerNetworkingPlugin(fleet, cookie);
  const gatewayShip = await commission(fleet, { cookie, ship: { name: 'gateway', type: 'gateway', scopes: GATEWAY_SCOPES } });
  expect((await connectGateway(address, { cookie, ...gatewayShip })).status).toBe(200);
  approver = await register(fleet, await commission(fleet, { cookie, ship: { name: 'approver', type: 'agent', scopes: ['fleet:read', 'gateway:approve'] } }));
  owner = (await commission(fleet, { cookie, ship: { name: 'charlotte', type: 'person', kind: 'person' } })).shipId;
  prisma = createPrismaClient(databaseUrl);
  const whoami = await fetch(`${fleet.url}/api/v1/ship/whoami`, { headers: { authorization: `Bearer ${approver}` } });
  const { fleetId } = z.object({ fleetId: z.templateLiteral(['flt_', z.string()]) }).parse(await whoami.json());
  const asked = new Date();
  await createPrismaPendingRequests(prisma).open({
    fleetId,
    requestId: REQUEST_ID,
    subject: { kind: 'client', clientId: 'https://orderbot.example.com/client.json', clientName: 'Orderbot' },
    requesters: [{ accountId: 'acc-charlotte', personShipId: owner }],
    askedAt: asked,
    expiresAt: new Date(asked.getTime() + 7 * 24 * 60 * 60_000),
    state: 'pending',
    decidedBy: null,
    decidedAt: null,
    now: asked,
  });
});

afterEach(async () => {
  await prisma.$disconnect();
  await app.close();
  await fleet.stop();
});

describe('an approver decides a pending request through the gateway', () => {
  it("approves it: the client's proxy ship is commissioned and crewed in the fleet, and the request leaves To decide", async () => {
    const listed = await query(address, { procedure: 'requests.toDecide', crewToken: approver });
    expect(listed.status, await listed.clone().text()).toBe(200);

    const decided = await mutate(address, {
      procedure: 'requests.decide',
      crewToken: approver,
      body: { requestId: REQUEST_ID, decision: { kind: 'approve', party: { name: 'orderbot', ownerShipId: owner, scopes: ['messages:send', 'messages:receive'] } } },
    });

    expect(decided.status, await decided.clone().text()).toBe(200);
    expect(z.object({ result: z.object({ data: z.object({ state: z.string(), party: z.object({ state: z.string() }) }) }) }).parse(await decided.json()).result.data).toEqual({ state: 'approved', party: { state: 'crewed' } });
    const after = z.object({ result: z.object({ data: z.array(z.unknown()) }) }).parse(await (await query(address, { procedure: 'requests.toDecide', crewToken: approver })).json());
    expect(after.result.data).toEqual([]);
  });
});
