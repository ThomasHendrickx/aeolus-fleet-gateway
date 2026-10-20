import { discoverOutputSchema, idSchema, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { MOCK_CRM_BEARER, startMockCrm, type MockCrm } from './fixtures/mock-crm/mock-crm.js';
import { applyEmptyOwnRules, commission, register, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';
import { connectGateway, mutate, query } from './support/gateway-api.js';
import { receiveOne, send } from './support/ship.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';
import { outsidePartiesOn } from './support/outside-parties.js';

// MCP out end to end (interop 3.3, 5.2): argo approves the mock CRM through
// the gateway, which commissions and crews its proxy ship owned by the owner
// picked (aeolus-fleet#959); a ship of the fleet calls the CRM's tools by
// sending to its proxy ship, and the gateway replies with each result.

const TOOL_CALL_TIMEOUT_MS = 1_000;
const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare'];

/** A reply's payload, read back. */
const parsed = (payload: string): unknown => JSON.parse(payload);

let fleet: FleetServer;
let crm: MockCrm;
let cookie: string;
let databaseUrl: string;
let caller: { shipId: ShipId; crewToken: string };
let gatewayShip: { shipId: ShipId; secret: string };
let owner: ShipId;
let proxyShipId: ShipId;
const apps: GatewayApp[] = [];

async function started(): Promise<string> {
  const app = createGatewayApp({ gatewaySecret: TEST_GATEWAY_SECRET, databaseUrl, fleetUrl: fleet.url, logger: false, toolCallTimeoutMs: TOOL_CALL_TIMEOUT_MS });
  apps.push(app);
  await app.restoreConnections();
  return app.server.listen({ host: '127.0.0.1', port: 0 });
}

beforeEach(async () => {
  [fleet, crm, databaseUrl] = await Promise.all([startFleetServer(inject('postgresUrl')), startMockCrm({ slowToolMs: 50 }), migratedDatabase(inject('postgresUrl'))]);
  cookie = await signIn(fleet);
  const agent = await commission(fleet, { cookie, ship: { name: 'agent', type: 'agent', scopes: ['messages:send'] } });
  caller = { shipId: agent.shipId, crewToken: await register(fleet, agent) };
  gatewayShip = await commission(fleet, { cookie, ship: { name: 'gateway', type: 'gateway', kind: 'app', scopes: GATEWAY_SCOPES } });
  owner = (await commission(fleet, { cookie, ship: { name: 'charlotte', type: 'person', kind: 'person' } })).shipId;
  const whoami = await fetch(`${fleet.url}/api/v1/ship/whoami`, { headers: { authorization: `Bearer ${caller.crewToken}` } });
  const { fleetId } = z.object({ fleetId: idSchema('fleet') }).parse(await whoami.json());
  await outsidePartiesOn(databaseUrl, fleetId);
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all([crm.close(), fleet.stop()]);
});

/** argo connects the gateway and approves the CRM through it: its proxy ship, commissioned and crewed by the gateway. */
async function approved(address: string): Promise<void> {
  expect((await connectGateway(address, { cookie, ...gatewayShip })).status).toBe(200);
  const response = await mutate(address, {
    procedure: 'parties.approve',
    cookie,
    body: { requestId: 'approve-crm', name: 'crm', url: crm.url, credential: { kind: 'bearer', token: MOCK_CRM_BEARER }, ownerShipId: owner, concurrencyLimit: 4 },
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const party = z.object({ result: z.object({ data: z.object({ state: z.literal('crewed'), proxyShipId: idSchema('ship') }) }) }).parse(await response.json());
  proxyShipId = party.result.data.proxyShipId;
}

function callTool(tool: string, args: Record<string, unknown>) {
  return send(fleet, { crewToken: caller.crewToken, to: proxyShipId, contentType: `application/vnd.aeolus.mcp-tool+json; name=${tool}`, payload: JSON.stringify(args) });
}

describe('a ship of the fleet calls an outside MCP server through its proxy ship', () => {
  it("gets the tool's result as a reply naming its request", async () => {
    await approved(await started());

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
    await approved(await started());

    await callTool('sync_ledger', {});

    const reply = await receiveOne(fleet, caller.crewToken);
    expect(reply && z.object({ isError: z.boolean() }).parse(parsed(reply.payload)).isError).toBe(true);
  });

  it('runs a call that may have run only once, though its answer was lost', async () => {
    crm.isSlowToolHeld = true;
    await approved(await started());

    await callTool('forecast_revenue', {});
    await new Promise((resolve) => setTimeout(resolve, TOOL_CALL_TIMEOUT_MS * 4));

    expect(crm.calls.get('forecast_revenue')).toBe(1);
  });

  it('takes the calls again after a restart, with the kept crew token', async () => {
    await approved(await started());
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await started();

    const request = await callTool('list_contacts', {});

    await expect(receiveOne(fleet, caller.crewToken).then((reply) => reply?.inReplyTo)).resolves.toBe(request);
  });
});

describe('a ship holding fleet:manage retires an outside MCP server party (decision 0056)', () => {
  it('retires its proxy ship in the fleet and forgets the party, so a call to it is refused', async () => {
    const address = await started();
    await approved(address);
    const manager = await commission(fleet, { cookie, ship: { name: 'manager', type: 'agent', scopes: ['fleet:manage'] } });

    const retired = await mutate(address, { procedure: 'parties.retire', crewToken: await register(fleet, manager), body: { name: 'crm' } });

    expect(retired.status).toBe(200);
    const listed = await query(address, { procedure: 'parties.list', cookie });
    expect(z.object({ result: z.object({ data: z.array(z.unknown()) }) }).parse(await listed.json()).result.data).toEqual([]);
    await expect(callTool('list_deals', { contactId: 'c1' })).rejects.toThrow();
  });
});

describe("an outside party's owner and scopes are the fleet's (decision 0056)", () => {
  it("lists the party with its proxy ship's owner and scopes, read from the fleet as the gateway's ship", async () => {
    const address = await started();
    await approved(address);

    const listed = await query(address, { procedure: 'parties.list', cookie });

    const [party] = z.object({ result: z.object({ data: z.array(z.object({ name: z.string(), ownerShipId: z.string().nullable(), scopes: z.array(z.string()).nullable() })) }) }).parse(await listed.json()).result.data;
    expect({ name: party?.name, isOwned: (party?.ownerShipId ?? '').startsWith('shp_'), canMessage: ['messages:send', 'messages:receive'].every((scope) => party?.scopes?.includes(scope)) }).toEqual({ name: 'crm', isOwned: true, canMessage: true });
  });
  it("lists the party without owner or scopes to a ship whose read reach does not hold its proxy ship, in a fleet that applies its own network rules", async () => {
    const address = await started();
    await approved(address);
    const reader = await register(fleet, await commission(fleet, { cookie, ship: { name: 'reader', type: 'agent', scopes: ['fleet:read'] } }));
    await applyEmptyOwnRules(fleet, cookie);

    const listed = await query(address, { procedure: 'parties.list', crewToken: reader });

    expect(z.object({ result: z.object({ data: z.array(z.object({ name: z.string(), ownerShipId: z.string().nullable(), scopes: z.array(z.string()).nullable() })) }) }).parse(await listed.json()).result.data).toMatchObject([{ name: 'crm', ownerShipId: null, scopes: null }]);
  });
});

describe("a ship holding scopes:grant changes an outside party's scopes (decision 0056)", () => {
  it('grants its proxy ship a scope the ship holds, which the party then shows from the fleet', async () => {
    const address = await started();
    await approved(address);
    const granter = await commission(fleet, { cookie, ship: { name: 'granter', type: 'agent', scopes: ['scopes:grant', 'fleet:read'] } });

    const changed = await mutate(address, { procedure: 'parties.changeScopes', crewToken: await register(fleet, granter), body: { name: 'crm', grant: ['fleet:read'], revoke: [] } });

    expect(changed.status).toBe(200);
    const read = await query(address, { procedure: 'parties.get', cookie, input: { name: 'crm' } });
    const { scopes } = z.object({ result: z.object({ data: z.object({ scopes: z.array(z.string()).nullable() }) }) }).parse(await read.json()).result.data;
    expect(scopes?.includes('fleet:read')).toBe(true);
  });
});

describe("the CRM's proxy ship states its tools as the server lists them (aeolus-fleet#956)", () => {
  it("shows in discovery each tool with the server's annotations, and argo's repeatable mark", async () => {
    const address = await started();
    await approved(address);

    const marked = await mutate(address, { procedure: 'parties.markTool', cookie, body: { name: 'crm', tool: 'list_deals', isRepeatable: true } });

    expect(marked.status, await marked.clone().text()).toBe(200);
    const found = await fetch(`${fleet.url}/api/v1/ship/discover`, { headers: { authorization: `Bearer ${caller.crewToken}` } });
    const statement = discoverOutputSchema.parse(await found.json()).ships.find(({ id }) => id === proxyShipId)?.statement;
    const capabilities = statement?.by === 'crew' ? statement.capabilities : [];
    const shown = capabilities.filter(({ name }) => ['list_deals', 'create_contact'].includes(name)).map(({ name, annotations, repeatable }) => ({ name, annotations, repeatable }));
    expect(shown.sort((left, right) => left.name.localeCompare(right.name))).toEqual([
      { name: 'create_contact', annotations: { readOnlyHint: false, idempotentHint: false }, repeatable: undefined },
      { name: 'list_deals', annotations: { readOnlyHint: true, idempotentHint: true }, repeatable: true },
    ]);
  });
});
