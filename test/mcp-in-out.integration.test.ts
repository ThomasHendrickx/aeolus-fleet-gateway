import { idSchema } from '@aeolus-fleet/common';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { createPrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaPartyStore } from '../src/adapters/prisma/party-store.js';
import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { statementOf } from '../src/core/mcp-out/statement.js';
import { MOCK_CRM_BEARER, startMockCrm, type MockCrm } from './fixtures/mock-crm/mock-crm.js';
import { commission, register, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { PAGASAE_CLIENT, startFakePagasae } from './support/fake-pagasae.js';
import { aFreePort, startFleetServer } from './support/fleet-server.js';
import { mutate } from './support/gateway-api.js';
import { aConnectedGateway, aSignedInClient, TEST_GATEWAY_SECRET, type Setting } from './support/mcp-client.js';
import { outsidePartiesOn } from './support/outside-parties.js';

// The journey of slice 2 end to end: an outside MCP client, signed in with
// the MCP TypeScript SDK, calls the mock CRM's tool. Its call travels as a
// message from its proxy ship, through the fleet, to the CRM's proxy ship,
// whose worker calls the mock CRM (MCP out); the result comes back as a
// reply, and the client is answered it (MCP in).
//
// Core 0.27 stand-ins: argo commissions the CRM's proxy ship in the console
// and hands its secret over with parties.crew (aeolus-fleet#959), and the
// test states it without the tools' annotations, which 0.27 refuses
// (aeolus-fleet#956).

let setting: Setting;
let app: GatewayApp;
let crm: MockCrm;

/** The CRM party, crewed by the gateway and stated as it would state it on core 0.28, without annotations. */
async function aCrewedCrmParty(): Promise<void> {
  const { fleet, cookie } = setting;
  const proxy = await commission(fleet, { cookie, ship: { name: 'crm', type: 'mcp-server', kind: 'app' } });
  const owner = await commission(fleet, { cookie, ship: { name: 'crm-owner', type: 'agent' } });
  const whoami = await fetch(`${fleet.url}/api/v1/ship/whoami`, { headers: { authorization: `Bearer ${await register(fleet, owner)}` } });
  const { fleetId } = z.object({ fleetId: idSchema('fleet') }).parse(await whoami.json());
  const prisma = createPrismaClient(setting.databaseUrl);
  const parties = createPrismaPartyStore(prisma);
  await parties.save({
    fleetId,
    name: 'crm',
    kind: 'mcpServer',
    url: crm.url,
    credential: { kind: 'bearer', token: MOCK_CRM_BEARER },
    ownerShipId: owner.shipId,
    concurrencyLimit: 4,
    state: 'awaitingCrew',
    proxyShipId: proxy.shipId,
    secret: null,
    crewToken: null,
    requestId: 'approve-crm',
    requestHash: 'h',
    approvedAt: new Date(),
  });
  await outsidePartiesOn(setting.databaseUrl, fleetId);
  const crewed = await mutate(setting.address, { procedure: 'parties.crew', cookie, body: { name: 'crm', secret: proxy.secret } });
  expect(crewed.status).toBe(200);
  const crewToken = z.string().parse((await parties.find(fleetId, 'crm'))?.crewToken);
  await prisma.$disconnect();
  await statedWithoutAnnotations(crewToken);
}

/** The CRM's proxy ship states the mock CRM's tools, as the gateway does, without their annotations. */
async function statedWithoutAnnotations(crewToken: string): Promise<void> {
  const outside = new Client({ name: 'test', version: '1' });
  await outside.connect(new StreamableHTTPClientTransport(new URL(crm.url), { requestInit: { headers: { authorization: `Bearer ${MOCK_CRM_BEARER}` } } }));
  const { tools } = await outside.listTools();
  await outside.close();
  const statement = statementOf({ partyName: 'crm', tools: tools.map(({ name, title, description, inputSchema }) => ({ name, ...(title === undefined ? {} : { title }), ...(description === undefined ? {} : { description }), inputSchema })), repeatable: new Set() });
  await expect(createRestFleetDoor(setting.fleet.url).setStatement(crewToken, statement)).resolves.toEqual({ isOk: true, value: undefined });
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
