import { idSchema, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaPartyStore } from '../src/adapters/prisma/party-store.js';
import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { MOCK_CRM_BEARER, startMockCrm, type MockCrm } from './fixtures/mock-crm/mock-crm.js';
import { commission, register, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';
import { mutate } from './support/gateway-api.js';
import { receiveOne, send } from './support/ship.js';

// MCP out end to end (interop 3.3, 5.2): a ship of the fleet calls the mock
// CRM's tools by sending to its proxy ship, and the gateway replies with each
// result. Core 0.27 commissions no app ship for the gateway (aeolus-fleet#959),
// so argo commissions it in the console, and the party is kept awaiting crew
// as the gateway's commission leaves it; argo then hands its secret over with
// parties.crew, as for a commission whose answer was lost.

const TOOL_CALL_TIMEOUT_MS = 1_000;

/** A reply's payload, read back. */
const parsed = (payload: string): unknown => JSON.parse(payload);

let fleet: FleetServer;
let crm: MockCrm;
let cookie: string;
let databaseUrl: string;
let caller: { shipId: ShipId; crewToken: string };
let proxy: { shipId: ShipId; secret: string };
const apps: GatewayApp[] = [];

async function started(): Promise<string> {
  const app = createGatewayApp({ databaseUrl, fleetUrl: fleet.url, logger: false, toolCallTimeoutMs: TOOL_CALL_TIMEOUT_MS });
  apps.push(app);
  await app.restoreConnections();
  return app.server.listen({ host: '127.0.0.1', port: 0 });
}

beforeEach(async () => {
  [fleet, crm, databaseUrl] = await Promise.all([startFleetServer(inject('postgresUrl')), startMockCrm({ slowToolMs: 50 }), migratedDatabase(inject('postgresUrl'))]);
  cookie = await signIn(fleet);
  const agent = await commission(fleet, { cookie, ship: { name: 'agent', type: 'agent', scopes: ['messages:send'] } });
  caller = { shipId: agent.shipId, crewToken: await register(fleet, agent) };
  proxy = await commission(fleet, { cookie, ship: { name: 'crm', type: 'mcp-server', kind: 'app' } });
  const whoami = await fetch(`${fleet.url}/api/v1/ship/whoami`, { headers: { authorization: `Bearer ${caller.crewToken}` } });
  const { fleetId } = z.object({ fleetId: idSchema('fleet') }).parse(await whoami.json());
  const prisma = createPrismaClient(databaseUrl);
  await createPrismaPartyStore(prisma).save({
    fleetId,
    name: 'crm',
    kind: 'mcpServer',
    url: crm.url,
    credential: { kind: 'bearer', token: MOCK_CRM_BEARER },
    // The owner is only kept by the gateway; core 0.28 checks it at the commission.
    ownerShipId: caller.shipId,
    concurrencyLimit: 4,
    state: 'awaitingCrew',
    proxyShipId: proxy.shipId,
    secret: null,
    crewToken: null,
    requestId: 'approve-crm',
    requestHash: 'h',
    approvedAt: new Date(),
  });
  await prisma.$disconnect();
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all([crm.close(), fleet.stop()]);
});

async function crewed(address: string): Promise<void> {
  const response = await mutate(address, { procedure: 'parties.crew', cookie, body: { name: 'crm', secret: proxy.secret } });
  expect(response.status).toBe(200);
}

function callTool(tool: string, args: Record<string, unknown>) {
  return send(fleet, { crewToken: caller.crewToken, to: proxy.shipId, contentType: `application/vnd.aeolus.mcp-tool+json; name=${tool}`, payload: JSON.stringify(args) });
}

describe('a ship of the fleet calls an outside MCP server through its proxy ship', () => {
  it("gets the tool's result as a reply naming its request", async () => {
    await crewed(await started());

    const request = await callTool('list_deals', { contactId: 'c1' });

    const reply = await receiveOne(fleet, caller.crewToken);
    expect(reply && { inReplyTo: reply.inReplyTo, contentType: reply.contentType, result: parsed(reply.payload) }).toEqual({
      inReplyTo: request,
      contentType: 'application/vnd.aeolus.mcp-result+json; name=list_deals',
      result: {
        content: [{ type: 'text', text: JSON.stringify([{ id: 'd1', contactId: 'c1', title: 'Analytical engine', amount: 1200 }]) }],
        structuredContent: { deals: [{ id: 'd1', contactId: 'c1', title: 'Analytical engine', amount: 1200 }] },
        isError: false,
      },
    });
  });

  it("gets a tool's error as its result", async () => {
    await crewed(await started());

    await callTool('sync_ledger', {});

    const reply = await receiveOne(fleet, caller.crewToken);
    expect(reply && z.object({ isError: z.boolean() }).parse(parsed(reply.payload)).isError).toBe(true);
  });

  it('runs a call that may have run only once, though its answer was lost', async () => {
    crm.isSlowToolHeld = true;
    await crewed(await started());

    await callTool('forecast_revenue', {});
    await new Promise((resolve) => setTimeout(resolve, TOOL_CALL_TIMEOUT_MS * 4));

    expect(crm.calls.get('forecast_revenue')).toBe(1);
  });

  it('takes the calls again after a restart, with the kept crew token', async () => {
    await crewed(await started());
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await started();

    const request = await callTool('list_contacts', {});

    await expect(receiveOne(fleet, caller.crewToken).then((reply) => reply?.inReplyTo)).resolves.toBe(request);
  });
});
