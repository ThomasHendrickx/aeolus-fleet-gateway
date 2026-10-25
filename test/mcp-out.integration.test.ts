import { discoverOutputSchema, idSchema, needsAttentionOutputSchema, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { MAY_HAVE_RUN } from '../src/core/mcp-out/hand-call.js';
import { MOCK_CRM_BEARER, startMockCrm, type MockCrm } from './fixtures/mock-crm/mock-crm.js';
import { applyEmptyOwnRules, commission, defineScope, grantScopes, register, signIn } from './support/argo.js';
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
/** How many times a test reads Needs attention, a tool call timeout apart, before it counts it empty. */
const NEEDS_ATTENTION_TRIES = 10;
const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify'];

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

/** Needs attention as argo reads it, once it lists a delivery: the gateway reports a call it judged may have run after its timeout. */
async function needsAttention() {
  for (let tries = 0; tries < NEEDS_ATTENTION_TRIES; tries += 1) {
    const response = await fetch(`${fleet.url}/trpc/fleet.needsAttention?input=${encodeURIComponent(JSON.stringify({}))}`, { headers: { cookie } });
    const listed = needsAttentionOutputSchema.parse(z.object({ result: z.object({ data: z.unknown() }) }).parse(await response.json()).result.data).items;
    if (listed.length > 0) {
      return listed;
    }
    await new Promise((resolve) => setTimeout(resolve, TOOL_CALL_TIMEOUT_MS));
  }
  return [];
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

  it('shows the call that may have run in Needs attention, saying why, for argo to dismiss (aeolus-fleet#955)', async () => {
    crm.isSlowToolHeld = true;
    await approved(await started());
    await callTool('forecast_revenue', {});

    const listed = await needsAttention();

    expect(listed.map(({ state, reason, ship }) => ({ state, reason, shipId: ship.id }))).toEqual([{ state: 'notHandled', reason: MAY_HAVE_RUN, shipId: proxyShipId }]);
    const dismissed = await fetch(`${fleet.url}/trpc/fleet.dismiss`, { method: 'POST', headers: { 'content-type': 'application/json', origin: fleet.url, cookie }, body: JSON.stringify({ deliveryId: listed[0]?.deliveryId }) });
    expect(dismissed.status, await dismissed.clone().text()).toBe(200);
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
  it("names the party's proxy ship and its owner, as the fleet names them", async () => {
    const address = await started();
    await approved(address);

    const listed = await query(address, { procedure: 'parties.list', cookie });

    const [party] = z.object({ result: z.object({ data: z.array(z.object({ proxyShipName: z.string().nullable(), ownerName: z.string().nullable() })) }) }).parse(await listed.json()).result.data;
    expect({ isProxyShipNamed: (party?.proxyShipName ?? '') !== '', ownerName: party?.ownerName }).toEqual({ isProxyShipNamed: true, ownerName: 'charlotte' });
  });

  it("offers as owners the fleet's person ships and argo, never an agent or app ship (decision 0045)", async () => {
    const address = await started();

    const choices = await query(address, { procedure: 'parties.ownerChoices', cookie });

    const names = z.object({ result: z.object({ data: z.array(z.object({ shipId: z.string(), name: z.string() })) }) }).parse(await choices.json()).result.data.map((choice) => choice.name);
    expect({ hasCharlotte: names.includes('charlotte'), hasAgent: names.includes('agent'), hasGateway: names.includes('gateway') }).toEqual({ hasCharlotte: true, hasAgent: false, hasGateway: false });
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

describe('an approver sets which scopes a calling ship needs for a tool of an outside MCP server (gateway scopes 4.2)', () => {
  let approver: string;

  /** The CRM approved, the fleet's own crm:write-leads defined, and an approver holding gateway:approve, the scope the gateway declares as it connects. */
  async function approvedWithScopes(): Promise<string> {
    const address = await started();
    await approved(address);
    await defineScope(fleet, { cookie, scope: 'crm:write-leads', description: 'Change leads in the CRM' });
    approver = await register(fleet, await commission(fleet, { cookie, ship: { name: 'approver', type: 'agent', scopes: ['fleet:read', 'gateway:approve'] } }));
    return address;
  }

  function setRequirements(address: string, body: { version: number; party?: string[]; tools: { tool: string; scopes: string[] }[] }) {
    return mutate(address, { procedure: 'parties.setScopeRequirements', crewToken: approver, body: { name: 'crm', ...body } });
  }

  it('refuses a call from a ship that lacks the scope, naming it, and the call never reaches the server', async () => {
    const address = await approvedWithScopes();
    const set = await setRequirements(address, { version: 0, tools: [{ tool: 'create_deal', scopes: ['crm:write-leads'] }] });
    expect(set.status, await set.clone().text()).toBe(200);

    const request = await callTool('create_deal', { contactId: 'c1', title: 'Difference engine', amount: 900 });

    const reply = await receiveOne(fleet, caller.crewToken);
    expect(reply && { inReplyTo: reply.inReplyTo, result: parsed(reply.payload) }).toEqual({
      inReplyTo: request,
      result: { content: [{ type: 'text', text: 'create_deal needs crm:write-leads, which agent does not hold' }], isError: true },
    });
    expect(crm.calls.get('create_deal')).toBeUndefined();
  });

  it('lets the call through once the ship is granted the scope, at its next call', async () => {
    const address = await approvedWithScopes();
    await setRequirements(address, { version: 0, party: ['crm:write-leads'], tools: [] });
    await grantScopes(fleet, { cookie, shipId: caller.shipId, grant: ['crm:write-leads'], revoke: [] });

    await callTool('list_deals', { contactId: 'c1' });

    expect(await receiveOne(fleet, caller.crewToken)).toMatchObject({ contentType: 'application/vnd.aeolus.mcp-result+json; name=list_deals' });
    expect(crm.calls.get('list_deals')).toBe(1);
  });

  it('refuses a scope the fleet does not list, by name, keeping nothing', async () => {
    const address = await approvedWithScopes();

    const set = await setRequirements(address, { version: 0, party: ['crm:admin'], tools: [] });

    expect({ status: set.status, message: z.object({ error: z.object({ message: z.string() }) }).parse(await set.json()).error.message }).toEqual({
      status: 400,
      message: 'The fleet lists no scope crm:admin: define it first, or pick a listed one',
    });
  });

  it('refuses the second of two changes made on the same version, keeping the first', async () => {
    const address = await approvedWithScopes();

    const both = await Promise.all([setRequirements(address, { version: 0, party: ['crm:write-leads'], tools: [] }), setRequirements(address, { version: 0, party: ['fleet:read'], tools: [] })]);

    expect(both.map(({ status }) => status).sort()).toEqual([200, 409]);
  });
});

describe('an approver picks which tools of an outside MCP server the fleet may call (aeolus-fleet#1151, #1153)', () => {
  const NOT_ENABLED = { content: [{ type: 'text', text: 'tool not enabled for this party' }], isError: true };
  let vault: MockCrm;
  let approver: string;

  beforeEach(async () => {
    vault = await startMockCrm({ slowToolMs: 50, isOpen: true });
  });

  afterEach(async () => {
    await vault.close();
  });

  /** The gateway connected, and an approver holding fleet:manage and gateway:approve, the scope the gateway declares as it connects. */
  async function connectedWithApprover(): Promise<string> {
    const address = await started();
    expect((await connectGateway(address, { cookie, ...gatewayShip })).status).toBe(200);
    approver = await register(fleet, await commission(fleet, { cookie, ship: { name: 'approver', type: 'agent', scopes: ['fleet:read', 'fleet:manage', 'gateway:approve'] } }));
    return address;
  }

  /** The approver adds the vault, which asks for no credential, with each tool switched as given. */
  async function vaultAdded(address: string, tools: { name: string; isOn: boolean }[]): Promise<void> {
    const response = await mutate(address, {
      procedure: 'parties.approve',
      crewToken: approver,
      body: { requestId: 'approve-vault', name: 'vault', url: vault.url, credential: { kind: 'none' }, ownerShipId: owner, concurrencyLimit: 4, tools },
    });
    expect(response.status, await response.clone().text()).toBe(200);
    proxyShipId = z.object({ result: z.object({ data: z.object({ proxyShipId: idSchema('ship') }) }) }).parse(await response.json()).result.data.proxyShipId;
  }

  /** The capabilities the fleet shows of the proxy ship, as a ship of the fleet discovers it, once the gateway stated it anew. */
  async function statedTools(address: string, party: string): Promise<string[]> {
    const restated = await mutate(address, { procedure: 'parties.state', crewToken: approver, body: { name: party } });
    expect(restated.status, await restated.clone().text()).toBe(200);
    const found = await fetch(`${fleet.url}/api/v1/ship/discover`, { headers: { authorization: `Bearer ${caller.crewToken}` } });
    const statement = discoverOutputSchema.parse(await found.json()).ships.find(({ id }) => id === proxyShipId)?.statement;
    return (statement?.by === 'crew' ? statement.capabilities : []).map(({ name }) => name).sort();
  }

  async function partyTools(address: string, party: string) {
    const read = await query(address, { procedure: 'parties.tools', crewToken: approver, input: { name: party } });
    return z.object({ result: z.object({ data: z.object({ tools: z.array(z.object({ name: z.string(), isOn: z.boolean(), isNew: z.boolean() })) }) }) }).parse(await read.json()).result.data.tools;
  }

  const EVERY_TOOL = ['create_contact', 'create_deal', 'forecast_revenue', 'get_contact', 'list_contacts', 'list_deals', 'sync_ledger'];

  it('adds a server that asks for no credential: the gateway sends it no Authorization header', async () => {
    await vaultAdded(await connectedWithApprover(), EVERY_TOOL.map((name) => ({ name, isOn: true })));

    await callTool('list_deals', {});

    expect(await receiveOne(fleet, caller.crewToken)).toMatchObject({ contentType: 'application/vnd.aeolus.mcp-result+json; name=list_deals' });
    expect(vault.authorizations.length).toBeGreaterThan(0);
    expect(vault.authorizations.every((authorization) => authorization === undefined)).toBe(true);
  });

  it('leaves a tool switched off out of what the fleet sees of the party', async () => {
    const address = await connectedWithApprover();
    await vaultAdded(address, EVERY_TOOL.map((name) => ({ name, isOn: name !== 'create_deal' })));

    expect(await statedTools(address, 'vault')).toEqual(EVERY_TOOL.filter((name) => name !== 'create_deal'));
  });

  it('refuses a call to a tool switched off with a plain error, and the call never reaches the server', async () => {
    await vaultAdded(await connectedWithApprover(), EVERY_TOOL.map((name) => ({ name, isOn: name !== 'create_deal' })));

    const request = await callTool('create_deal', { contactId: 'c1', title: 'Difference engine', amount: 900 });

    const reply = await receiveOne(fleet, caller.crewToken);
    expect(reply && { inReplyTo: reply.inReplyTo, result: parsed(reply.payload) }).toEqual({ inReplyTo: request, result: NOT_ENABLED });
    expect({ calls: vault.calls.get('create_deal'), deals: vault.deals.length }).toEqual({ calls: undefined, deals: 1 });
  });

  it('starts a tool the server adds after it was added off and new, until an approver switches it on', async () => {
    const address = await connectedWithApprover();
    await vaultAdded(address, EVERY_TOOL.map((name) => ({ name, isOn: true })));
    vault.addedTools.push('archive_contact');

    expect({ stated: await statedTools(address, 'vault'), tool: (await partyTools(address, 'vault')).find(({ name }) => name === 'archive_contact') }).toEqual({
      stated: EVERY_TOOL,
      tool: { name: 'archive_contact', isOn: false, isNew: true },
    });

    const switched = await mutate(address, { procedure: 'parties.switchTool', crewToken: approver, body: { name: 'vault', tool: 'archive_contact', isOn: true } });
    expect(switched.status, await switched.clone().text()).toBe(200);
    await callTool('archive_contact', {});
    expect(await receiveOne(fleet, caller.crewToken).then((reply) => reply && parsed(reply.payload))).toEqual({ content: [{ type: 'text', text: 'archive_contact' }], isError: false });
  });

  it('switches a tool off on the party later: the fleet sees it no more, and a call to it reaches no server', async () => {
    const address = await connectedWithApprover();
    await vaultAdded(address, EVERY_TOOL.map((name) => ({ name, isOn: true })));

    const switched = await mutate(address, { procedure: 'parties.switchTool', crewToken: approver, body: { name: 'vault', tool: 'create_contact', isOn: false } });

    expect(switched.status, await switched.clone().text()).toBe(200);
    expect(await statedTools(address, 'vault')).toEqual(EVERY_TOOL.filter((name) => name !== 'create_contact'));
    await callTool('create_contact', { name: 'Grace Hopper', email: 'grace@example.com' });
    expect(await receiveOne(fleet, caller.crewToken).then((reply) => reply && parsed(reply.payload))).toEqual(NOT_ENABLED);
    expect(vault.calls.get('create_contact')).toBeUndefined();
  });

  it('keeps every tool on of a party added before tools were switched, and starts a tool added after that off', async () => {
    const address = await connectedWithApprover();
    // Added with no tool choice, as every party before this and every party approved through a request.
    const added = await mutate(address, { procedure: 'parties.approve', crewToken: approver, body: { requestId: 'approve-old', name: 'old', url: vault.url, credential: { kind: 'none' }, ownerShipId: owner, concurrencyLimit: 4 } });
    proxyShipId = z.object({ result: z.object({ data: z.object({ proxyShipId: idSchema('ship') }) }) }).parse(await added.json()).result.data.proxyShipId;

    expect(await statedTools(address, 'old')).toEqual(EVERY_TOOL);
    vault.addedTools.push('archive_contact');
    expect(await statedTools(address, 'old')).toEqual(EVERY_TOOL);
  });
});
