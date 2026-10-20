import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { MOCK_CRM_BEARER, startMockCrm, type MockCrm } from './fixtures/mock-crm/mock-crm.js';
import { commission, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { PAGASAE_CLIENT, startFakePagasae } from './support/fake-pagasae.js';
import { aFreePort, startFleetServer } from './support/fleet-server.js';
import { mutate } from './support/gateway-api.js';
import { aConnectedGateway, aSignedInClient, fleetIdOf, TEST_GATEWAY_SECRET, type Setting } from './support/mcp-client.js';
import { outsidePartiesOn } from './support/outside-parties.js';

// The journey of slice 2 end to end: an outside MCP client, signed in with
// the MCP TypeScript SDK, calls the mock CRM's tool. Its call travels as a
// message from its proxy ship, through the fleet, to the CRM's proxy ship,
// whose worker calls the mock CRM (MCP out); the result comes back as a
// reply, and the client is answered it (MCP in).

let setting: Setting;
let app: GatewayApp;
let crm: MockCrm;

/** argo approves the CRM through the gateway, which crews its proxy ship, and has the gateway state its tools. */
async function aCrewedCrmParty(): Promise<void> {
  const { fleet, cookie, address } = setting;
  const owner = await commission(fleet, { cookie, ship: { name: 'crm-owner', type: 'person', kind: 'person' } });
  await outsidePartiesOn(setting.databaseUrl, await fleetIdOf(setting));
  const approved = await mutate(address, {
    procedure: 'parties.approve',
    cookie,
    body: { requestId: 'approve-crm', name: 'crm', url: crm.url, credential: { kind: 'bearer', token: MOCK_CRM_BEARER }, ownerShipId: owner.shipId, concurrencyLimit: 4 },
  });
  expect(approved.status, await approved.clone().text()).toBe(200);
  const stated = await mutate(address, { procedure: 'parties.state', cookie, body: { name: 'crm' } });
  expect(stated.status, await stated.clone().text()).toBe(200);
}

beforeEach(async () => {
  const [fleet, mockCrm, databaseUrl] = await Promise.all([startFleetServer(inject('postgresUrl')), startMockCrm(), migratedDatabase(inject('postgresUrl'))]);
  crm = mockCrm;
  const port = await aFreePort();
  const address = `http://127.0.0.1:${String(port)}`;
  setting = { fleet, address, cookie: await signIn(fleet), databaseUrl, pagasae: await startFakePagasae() };
  app = createGatewayApp({ databaseUrl, fleetUrl: fleet.url, logger: false, publicUrl: address, gatewaySecret: TEST_GATEWAY_SECRET, pagasae: { url: setting.pagasae.url, ...PAGASAE_CLIENT } });
  await app.server.listen({ host: '127.0.0.1', port });
  await aConnectedGateway(setting);
});

afterEach(async () => {
  await app.close();
  await setting.pagasae.stop();
  await Promise.all([crm.close(), setting.fleet.stop()]);
});

/** The SDK client of a signed-in MCP client, connected to the gateway, and the name it knows a CRM tool by. */
async function aConnectedClient(tool: string): Promise<{ mcp: Client; name: string }> {
  const client = await aSignedInClient(setting);
  const mcp = new Client({ name: 'test-client', version: '1' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${setting.address}/mcp`), { authProvider: client.provider }));
  const { tools } = await mcp.listTools();
  return { mcp, name: z.string().parse(tools.find((each) => each.name.endsWith(`__${tool}`))?.name) };
}

describe('an outside MCP client calls an outside MCP server through the fleet', () => {
  it("is answered the server's tool result, through both proxy ships", async () => {
    await aCrewedCrmParty();
    const { mcp, name } = await aConnectedClient('list_deals');

    const result = await mcp.callTool({ name, arguments: { contactId: 'c1' } });
    await mcp.close();

    const deals = [{ id: 'd1', contactId: 'c1', title: 'Analytical engine', amount: 1200 }];
    expect(result).toEqual({ content: [{ type: 'text', text: JSON.stringify(deals) }], structuredContent: { deals }, isError: false });
    expect(crm.calls.get('list_deals')).toBe(1);
  });

  it('runs a tool that is not repeatable once, though the client calls it again under the same idempotency argument', async () => {
    await aCrewedCrmParty();
    const { mcp, name } = await aConnectedClient('create_contact');
    const call = { name, arguments: { name: 'Grace Hopper', email: 'grace@example.com', aeolus_idempotency_key: 'create-grace' } };

    const results = [await mcp.callTool(call), await mcp.callTool(call)];
    await mcp.close();

    expect(results[0]).toEqual(results[1]);
    expect({ runs: crm.calls.get('create_contact'), contacts: crm.contacts.filter((contact) => contact.name === 'Grace Hopper').length }).toEqual({ runs: 1, contacts: 1 });
  });
});
