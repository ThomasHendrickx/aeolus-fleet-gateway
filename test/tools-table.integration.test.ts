import { discoverOutputSchema, idSchema, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { CHANGING_TOOLS, DESTRUCTIVE_TOOLS, EVERY_FIFTY_TOOL, HINTLESS_TOOLS, READ_ONLY_TOOLS, startFiftyTools, type FiftyTools } from './fixtures/fifty-tools/fifty-tools.js';
import { applyEmptyOwnRules, commission, defineScope, register, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';
import { connectGateway, mutate, query } from './support/gateway-api.js';
import { TEST_GATEWAY_SECRET } from './support/mcp-client.js';
import { outsidePartiesOn } from './support/outside-parties.js';

// The tools table of gateway scopes 4.3 against a real core and the 50-tool
// test server: what the page reads, and each change it makes, as the API
// answers an approver ship. Every bulk change is one call, kept whole or not
// at all. Each change is the one the page sends for it, as its unit tests
// show the page builds it.

const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify'];

let fleet: FleetServer;
let server: FiftyTools;
let cookie: string;
let databaseUrl: string;
let reader: string;
let approver: string;
let address: string;
let proxyShipId: ShipId;
const apps: GatewayApp[] = [];

const dataOf = <T extends z.ZodType>(schema: T) => z.object({ result: z.object({ data: schema }) });
const listedToolSchema = z.object({ name: z.string(), isReadOnly: z.boolean().optional(), isDestructive: z.boolean().optional(), isOn: z.boolean(), isNew: z.boolean() });
const requirementsSchema = z.object({ version: z.number(), party: z.array(z.string()), tools: z.array(z.object({ tool: z.string(), scopes: z.array(z.string()) })) });

beforeEach(async () => {
  [fleet, server, databaseUrl] = await Promise.all([startFleetServer(inject('postgresUrl')), startFiftyTools(), migratedDatabase(inject('postgresUrl'))]);
  cookie = await signIn(fleet);
  const gatewayShip = await commission(fleet, { cookie, ship: { name: 'gateway', type: 'gateway', kind: 'app', scopes: GATEWAY_SCOPES } });
  const owner = (await commission(fleet, { cookie, ship: { name: 'charlotte', type: 'person', kind: 'person' } })).shipId;
  reader = await register(fleet, await commission(fleet, { cookie, ship: { name: 'reader', type: 'agent', scopes: ['messages:send'] } }));
  const whoami = await fetch(`${fleet.url}/api/v1/ship/whoami`, { headers: { authorization: `Bearer ${reader}` } });
  await outsidePartiesOn(databaseUrl, z.object({ fleetId: idSchema('fleet') }).parse(await whoami.json()).fleetId);
  const app = createGatewayApp({ gatewaySecret: TEST_GATEWAY_SECRET, databaseUrl, fleetUrl: fleet.url, logger: false });
  apps.push(app);
  await app.restoreConnections();
  address = await app.server.listen({ host: '127.0.0.1', port: 0 });
  expect((await connectGateway(address, { cookie, ...gatewayShip })).status).toBe(200);
  for (const [scope, description] of [['crm:read-leads', 'Read leads in the CRM'], ['crm:write-leads', 'Change leads in the CRM'], ['crm:admin', 'Administer the CRM']] as const) {
    await defineScope(fleet, { cookie, scope, description });
  }
  approver = await register(fleet, await commission(fleet, { cookie, ship: { name: 'approver', type: 'agent', scopes: ['fleet:read', 'fleet:manage', 'gateway:approve'] } }));
  const added = await mutate(address, {
    procedure: 'parties.approve',
    crewToken: approver,
    body: { requestId: 'approve-crm', name: 'crm', url: server.url, credential: { kind: 'none' }, ownerShipId: owner, concurrencyLimit: 4, tools: EVERY_FIFTY_TOOL.map((name) => ({ name, isOn: true })) },
  });
  expect(added.status, await added.clone().text()).toBe(200);
  proxyShipId = dataOf(z.object({ proxyShipId: idSchema('ship') })).parse(await added.json()).result.data.proxyShipId;
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all([server.close(), fleet.stop()]);
});

async function listedTools() {
  const read = await query(address, { procedure: 'parties.tools', crewToken: approver, input: { name: 'crm' } });
  return dataOf(z.object({ tools: z.array(listedToolSchema) })).parse(await read.json()).result.data.tools;
}

async function requirements() {
  const read = await query(address, { procedure: 'parties.scopeRequirements', crewToken: approver, input: { name: 'crm' } });
  return dataOf(requirementsSchema).parse(await read.json()).result.data;
}

function setScopes(body: { version: number; party?: string[]; tools: { tool: string; scopes: string[] }[] }) {
  return mutate(address, { procedure: 'parties.setScopeRequirements', crewToken: approver, body: { name: 'crm', ...body } });
}

const scopesByTool = (kept: z.infer<typeof requirementsSchema>) => new Map(kept.tools.map(({ tool, scopes }) => [tool, scopes]));

describe("an approver sets the scopes on a 50-tool server's tools table (gateway scopes 4.3, A6)", () => {
  it('reads every tool the server lists with the hints it gives', async () => {
    const tools = await listedTools();

    expect({
      count: tools.length,
      readOnly: tools.filter(({ isReadOnly }) => isReadOnly === true).length,
      destructive: tools.filter(({ isDestructive }) => isDestructive === true).map(({ name }) => name),
      withoutHints: tools.filter(({ isReadOnly, isDestructive }) => isReadOnly === undefined && isDestructive === undefined).map(({ name }) => name),
    }).toEqual({ count: 50, readOnly: 31, destructive: DESTRUCTIVE_TOOLS, withoutHints: HINTLESS_TOOLS });
  });

  it('reads the scopes the fleet lists, with their descriptions, and that the approver approves the party', async () => {
    const [listed, approving] = await Promise.all([
      query(address, { procedure: 'parties.listedScopes', crewToken: approver }).then(async (response) => dataOf(z.object({ scopes: z.array(z.object({ scope: z.string(), description: z.string() })) })).parse(await response.json()).result.data.scopes),
      query(address, { procedure: 'parties.approving', crewToken: approver, input: { name: 'crm' } }).then(async (response) => dataOf(z.object({ isApproving: z.boolean(), reason: z.string().nullable() })).parse(await response.json()).result.data),
    ]);

    expect(listed.filter(({ scope }) => scope.startsWith('crm:'))).toEqual([
      { scope: 'crm:admin', description: 'Administer the CRM' },
      { scope: 'crm:read-leads', description: 'Read leads in the CRM' },
      { scope: 'crm:write-leads', description: 'Change leads in the CRM' },
    ]);
    expect(approving).toEqual({ isApproving: true, reason: null });
  });

  it("answers that an approver outside the proxy ship's manage reach does not approve it, in the fleet's words", async () => {
    await applyEmptyOwnRules(fleet, cookie);

    const approving = await query(address, { procedure: 'parties.approving', crewToken: approver, input: { name: 'crm' } });

    expect(dataOf(z.object({ isApproving: z.boolean(), reason: z.string() })).parse(await approving.json()).result.data.isApproving).toBe(false);
  });

  it('applies Suggest from hints in one change: 31 read-only tools need crm:read-leads, 14 crm:write-leads, the 5 without hints untouched', async () => {
    const suggested = [...READ_ONLY_TOOLS.map((tool) => ({ tool, scopes: ['crm:read-leads'] })), ...[...CHANGING_TOOLS, ...DESTRUCTIVE_TOOLS].map((tool) => ({ tool, scopes: ['crm:write-leads'] }))];

    const set = await setScopes({ version: 0, tools: suggested });

    expect(set.status, await set.clone().text()).toBe(200);
    const kept = await requirements();
    const byTool = scopesByTool(kept);
    expect({
      version: kept.version,
      read: READ_ONLY_TOOLS.every((tool) => byTool.get(tool)?.join() === 'crm:read-leads'),
      write: [...CHANGING_TOOLS, ...DESTRUCTIVE_TOOLS].every((tool) => byTool.get(tool)?.join() === 'crm:write-leads'),
      untouched: HINTLESS_TOOLS.filter((tool) => byTool.has(tool)),
    }).toEqual({ version: 1, read: true, write: true, untouched: [] });
  });

  it('adds crm:admin to the 3 delete tools filtered by name, keeping what each needs already', async () => {
    await setScopes({ version: 0, tools: DESTRUCTIVE_TOOLS.map((tool) => ({ tool, scopes: ['crm:write-leads'] })) });
    const selected = (await listedTools()).filter(({ name }) => name.includes('delete')).map(({ name }) => name);

    const set = await setScopes({ version: 1, tools: selected.map((tool) => ({ tool, scopes: ['crm:write-leads', 'crm:admin'] })) });

    expect(set.status, await set.clone().text()).toBe(200);
    expect(Object.fromEntries(scopesByTool(await requirements()))).toEqual({
      delete_lead: ['crm:write-leads', 'crm:admin'],
      delete_deal: ['crm:write-leads', 'crm:admin'],
      delete_note: ['crm:write-leads', 'crm:admin'],
    });
  });

  it('keeps one of two bulk changes made at once on the same version whole, and nothing of the other', async () => {
    const [first, second] = [EVERY_FIFTY_TOOL.slice(0, 25), EVERY_FIFTY_TOOL.slice(25)];

    const both = await Promise.all([setScopes({ version: 0, tools: first.map((tool) => ({ tool, scopes: ['crm:read-leads'] })) }), setScopes({ version: 0, tools: second.map((tool) => ({ tool, scopes: ['crm:write-leads'] })) })]);

    expect(both.map(({ status }) => status).sort()).toEqual([200, 409]);
    const kept = (await requirements()).tools.map(({ tool }) => tool).sort();
    expect([[...first].sort(), [...second].sort()]).toContainEqual(kept);
  });

  it('sets what every tool needs, beside what each needs of its own', async () => {
    const set = await setScopes({ version: 0, party: ['crm:read-leads'], tools: [] });

    expect(set.status, await set.clone().text()).toBe(200);
    expect(await requirements()).toEqual({ version: 1, party: ['crm:read-leads'], tools: [] });
  });

  it('switches the 3 selected delete tools off in one change: the fleet sees the other 47', async () => {
    const switched = await mutate(address, { procedure: 'parties.switchTools', crewToken: approver, body: { name: 'crm', tools: DESTRUCTIVE_TOOLS, isOn: false } });

    expect(switched.status, await switched.clone().text()).toBe(200);
    const found = await fetch(`${fleet.url}/api/v1/ship/discover`, { headers: { authorization: `Bearer ${reader}` } });
    const statement = discoverOutputSchema.parse(await found.json()).ships.find(({ id }) => id === proxyShipId)?.statement;
    const stated = (statement?.by === 'crew' ? statement.capabilities : []).map(({ name }) => name);
    expect({ count: stated.length, isAnyDeleteStated: stated.some((name) => DESTRUCTIVE_TOOLS.includes(name)) }).toEqual({ count: 47, isAnyDeleteStated: false });
    expect((await listedTools()).filter(({ isOn }) => !isOn).map(({ name }) => name)).toEqual(DESTRUCTIVE_TOOLS);
  });
});
