import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { commission, register, signIn } from './support/argo.js';
import { receiveOne } from './support/ship.js';
import { migratedDatabase } from './support/database.js';
import { aFreePort, startFleetServer } from './support/fleet-server.js';
import { aSignedInClient, TEST_GATEWAY_SECRET, type Setting } from './support/mcp-client.js';

// MCP in (interop 3.3): an outside MCP client, signed in, sees the
// capabilities of the ships its party reaches as tools, named by alias.

let setting: Setting;
let app: GatewayApp;

beforeEach(async () => {
  const fleet = await startFleetServer(inject('postgresUrl'));
  const port = await aFreePort();
  const address = `http://127.0.0.1:${String(port)}`;
  setting = { fleet, address, cookie: await signIn(fleet), databaseUrl: await migratedDatabase(inject('postgresUrl')) };
  app = createGatewayApp({ databaseUrl: setting.databaseUrl, fleetUrl: fleet.url, logger: false, publicUrl: address, gatewaySecret: TEST_GATEWAY_SECRET });
  await app.server.listen({ host: '127.0.0.1', port });
});

afterEach(async () => {
  await app.close();
  await setting.fleet.stop();
});

/** A ship of the fleet that states one capability, as its crew: its crew token. */
async function aStatingShip(): Promise<string> {
  const ship = await commission(setting.fleet, { cookie: setting.cookie, ship: { name: 'crm', type: 'crm', kind: 'app' } });
  const crewToken = await register(setting.fleet, ship);
  const response = await fetch(`${setting.fleet.url}/api/v1/ship/setStatement`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` },
    body: JSON.stringify({
      summary: 'The CRM: contacts and deals.',
      capabilities: [{ name: 'list_deals', description: "Lists a contact's deals.", inputSchema: { type: 'object', properties: { contactId: { type: 'string' } } }, inputModes: ['application/json'] }],
    }),
  });
  expect(response.status).toBe(200);
  return crewToken;
}

/** The SDK client of a signed-in MCP client, connected to the gateway's MCP endpoint. */
async function aConnectedClient(): Promise<Client> {
  const client = await aSignedInClient(setting);
  const mcp = new Client({ name: 'test-client', version: '1' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${setting.address}/mcp`), { authProvider: client.provider }));
  return mcp;
}

const textOf = (result: Awaited<ReturnType<Client['callTool']>>) => z.string().parse(z.array(z.object({ text: z.string() })).parse(result.content)[0]?.text);

describe('an outside MCP client lists the tools of the ships its party reaches', () => {
  it("lists a ship's capability as a tool named by alias, never by the ship's name", async () => {
    await aStatingShip();
    const client = await aSignedInClient(setting);
    const mcp = new Client({ name: 'test-client', version: '1' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${setting.address}/mcp`), { authProvider: client.provider }));

    const { tools } = await mcp.listTools();
    await mcp.close();

    expect(tools.map((tool) => [/^[a-z][a-z0-9]{7}__list_deals$/.test(tool.name), tool.description])).toEqual([[true, "Lists a contact's deals.\n\nOffered by: The CRM: contacts and deals."]]);
    expect(JSON.stringify(tools)).not.toContain('crm"');
  });

  it('answers 401 with where to sign in to a call without a token (RFC 9728)', async () => {
    const response = await fetch(`${setting.address}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });

    expect({ status: response.status, challenge: response.headers.get('www-authenticate') }).toEqual({
      status: 401,
      challenge: `Bearer resource_metadata="${setting.address}/.well-known/oauth-protected-resource/mcp"`,
    });
  });

  it('answers 401 invalid_token to a token it did not issue', async () => {
    const response = await fetch(`${setting.address}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer not-a-token' }, body: '{}' });

    expect({ status: response.status, challenge: response.headers.get('www-authenticate') }).toEqual({
      status: 401,
      challenge: `Bearer error="invalid_token", resource_metadata="${setting.address}/.well-known/oauth-protected-resource/mcp"`,
    });
  });
});

describe("an outside MCP client's tool call is a message its proxy ship sends", () => {
  it("delivers the call's arguments to the ship, and answers a handle aeolus_result reads", async () => {
    const crm = await aStatingShip();
    const mcp = await aConnectedClient();
    const [tool] = (await mcp.listTools()).tools.filter((each) => each.name.endsWith('__list_deals'));

    const called = await mcp.callTool({ name: z.string().parse(tool?.name), arguments: { contactId: 'c1' } });
    const { handle } = z.object({ handle: z.string() }).parse(JSON.parse(textOf(called)));
    const read = await mcp.callTool({ name: 'aeolus_result', arguments: { handle } });
    await mcp.close();

    expect(await receiveOne(setting.fleet, crm)).toMatchObject({ contentType: 'application/json', payload: '{"contactId":"c1"}' });
    expect(JSON.parse(textOf(read))).toEqual({ handle, state: 'submitted' });
  });

  it('sends the same call under the same idempotency argument once', async () => {
    const crm = await aStatingShip();
    const mcp = await aConnectedClient();
    const [tool] = (await mcp.listTools()).tools.filter((each) => each.name.endsWith('__list_deals'));
    const call = { name: z.string().parse(tool?.name), arguments: { contactId: 'c1', aeolus_idempotency_key: 'k-1' } };

    const handles = [textOf(await mcp.callTool(call)), textOf(await mcp.callTool(call))];
    await mcp.close();

    expect(handles[0]).toBe(handles[1]);
    expect([await receiveOne(setting.fleet, crm), await receiveOne(setting.fleet, crm)].map((delivery) => delivery !== undefined)).toEqual([true, false]);
  });

  it('answers a tool error, sending nothing, for a tool it does not list', async () => {
    const mcp = await aConnectedClient();

    const called = await mcp.callTool({ name: 'aaaaaaaa__drop_tables', arguments: {} });
    await mcp.close();

    expect(called.isError).toBe(true);
  });
});
