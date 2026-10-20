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
import { outsidePartiesOn } from './support/outside-parties.js';

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
  await outsidePartiesOn(databaseUrl, fleetId);
});

afterEach(async () => {
  await prisma.$disconnect();
  await app.close();
  await fleet.stop();
});

/** The request ids To decide lists for the approver. */
async function toDecide(): Promise<string[]> {
  const listed = await query(address, { procedure: 'requests.toDecide', crewToken: approver });
  return z.object({ result: z.object({ data: z.array(z.object({ requestId: z.string() })) }) }).parse(await listed.json()).result.data.map(({ requestId }) => requestId);
}

describe('an approver decides a pending request through the gateway', () => {
  it('denies it as an agent ship holding gateway:approve, and it leaves To decide', async () => {
    await expect(toDecide()).resolves.toEqual([REQUEST_ID]);

    const decided = await mutate(address, { procedure: 'requests.decide', crewToken: approver, body: { requestId: REQUEST_ID, decision: { kind: 'deny' } } });

    expect(decided.status, await decided.clone().text()).toBe(200);
    await expect(toDecide()).resolves.toEqual([]);
  });

  // Core 0.27 commissions no app ship for the gateway (aeolus-fleet#959), so the fleet refuses
  // the proxy ship here: the unhappy path of an approval, end to end. The approval itself is
  // proven against the fleet's stand-in in decide-request.test.ts until core 0.28.0.
  it('keeps it pending, undecided, when the fleet refuses the proxy ship', async () => {
    const decided = await mutate(address, {
      procedure: 'requests.decide',
      crewToken: approver,
      body: { requestId: REQUEST_ID, decision: { kind: 'approve', party: { name: 'orderbot', ownerShipId: owner, scopes: ['messages:send', 'messages:receive'] } } },
    });

    expect(decided.status).toBe(400);
    await expect(toDecide()).resolves.toEqual([REQUEST_ID]);
  });
});
