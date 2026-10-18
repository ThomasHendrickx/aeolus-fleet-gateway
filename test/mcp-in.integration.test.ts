import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { commission, register, signIn } from './support/argo.js';
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

/** A ship of the fleet that states one capability, as its crew. */
async function aStatingShip(): Promise<void> {
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
}

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
