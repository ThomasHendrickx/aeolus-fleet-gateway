import { idSchema, type FleetId } from '@aeolus-fleet/common';
import { Client, StreamableHTTPClientTransport, auth } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { commission, register, registerNetworkingPlugin, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { startFakePagasae, PAGASAE_CLIENT, type FakePagasae } from './support/fake-pagasae.js';
import { aFreePort, startFleetServer } from './support/fleet-server.js';
import { connectGateway } from './support/gateway-api.js';
import { aClientProvider, aRegisteredClient, CALLBACK, TEST_GATEWAY_SECRET, type Setting } from './support/mcp-client.js';

// A person signs in to the gateway through pagasae from their MCP client, as
// Claude would (decision 0054): with no console session, /authorize sends
// them to pagasae, pagasae sends them back, and the client takes the
// gateway's code for tokens. Here pagasae is a fake; the fleet and the
// gateway are real.

const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare'];

let setting: Setting;
let app: GatewayApp;
let pagasae: FakePagasae;
let fleetId: FleetId;

beforeEach(async () => {
  const fleet = await startFleetServer(inject('postgresUrl'));
  const port = await aFreePort();
  const address = `http://127.0.0.1:${String(port)}`;
  pagasae = await startFakePagasae();
  setting = { fleet, address, cookie: await signIn(fleet), databaseUrl: await migratedDatabase(inject('postgresUrl')) };
  app = createGatewayApp({ databaseUrl: setting.databaseUrl, fleetUrl: fleet.url, logger: false, publicUrl: address, gatewaySecret: TEST_GATEWAY_SECRET, pagasae: { url: pagasae.url, ...PAGASAE_CLIENT } });
  await app.server.listen({ host: '127.0.0.1', port });
  const gatewayShip = await commission(fleet, { cookie: setting.cookie, ship: { name: 'gateway', type: 'gateway', scopes: GATEWAY_SCOPES } });
  const probeCrew = await register(fleet, await commission(fleet, { cookie: setting.cookie, ship: { name: 'probe', type: 'agent' } }));
  const whoami = await fetch(`${fleet.url}/api/v1/ship/whoami`, { headers: { authorization: `Bearer ${probeCrew}` } });
  fleetId = z.object({ fleetId: idSchema('fleet') }).parse(await whoami.json()).fleetId;
  await registerNetworkingPlugin(fleet, setting.cookie);
  expect((await connectGateway(address, { cookie: setting.cookie, ...gatewayShip })).status).toBe(200);
});

afterEach(async () => {
  await app.close();
  await pagasae.stop();
  await setting.fleet.stop();
});

/** Charlotte's account token claims in a fleet. */
function charlotteIn(fleet: string): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return { iss: pagasae.url, aud: fleet, sub: 'acc-charlotte', org: 'org-acme', scope: 'fleet:read', group: ['sales'], iat: now, exp: now + 600 };
}

/**
 * Follows the browser through the redirects from the gateway's /authorize,
 * with no console session: where it lands last. It sends each site back the
 * cookies it set, as a browser does; one that keeps no cookies stands for
 * another browser finishing the sign-in.
 */
async function browserFrom(sentTo: URL, browser: { isKeepingCookies: boolean } = { isKeepingCookies: true }): Promise<Response> {
  const jar = new Map<string, string[]>();
  const visit = async (url: string) => {
    const { origin } = new URL(url);
    const cookies = jar.get(origin) ?? [];
    const response = await fetch(url, { redirect: 'manual', headers: cookies.length === 0 ? {} : { cookie: cookies.join('; ') } });
    if (browser.isKeepingCookies) {
      jar.set(origin, [...cookies, ...response.headers.getSetCookie().map((cookie) => cookie.split(';', 1)[0] ?? '')]);
    }
    return response;
  };
  let response = await visit(sentTo.toString());
  for (let hop = 0; hop < 3 && response.status === 302; hop += 1) {
    const next = z.string().parse(response.headers.get('location'));
    if (next.startsWith(CALLBACK)) {
      return response;
    }
    response = await visit(next);
  }
  return response;
}

describe('a person signs in from their MCP client through pagasae', () => {
  it("gets tokens with no approval, and their MCP session lists their person ship's tools", async () => {
    pagasae.answer(charlotteIn(fleetId));
    const client = aClientProvider(await aRegisteredClient(setting, false));
    const serverUrl = `${setting.address}/mcp`;
    await expect(auth(client.provider, { serverUrl })).resolves.toBe('REDIRECT');

    const back = new URL(z.string().parse((await browserFrom(z.instanceof(URL).parse(client.sentTo()))).headers.get('location')));
    const iss = back.searchParams.get('iss');
    await expect(auth(client.provider, { serverUrl, authorizationCode: z.string().parse(back.searchParams.get('code')), ...(iss === null ? {} : { iss }) })).resolves.toBe('AUTHORIZED');
    const mcp = new Client({ name: 'charlotte', version: '1' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider: client.provider }));

    const listed = await mcp.listTools();
    const read = await mcp.callTool({ name: 'aeolus_inbox', arguments: {} });

    expect({ tools: listed.tools.map(({ name }) => name), read }).toEqual({
      tools: ['aeolus_inbox', 'aeolus_open', 'aeolus_answer', 'aeolus_done'],
      // pagasae names no person ship for Charlotte here, so the gateway asks the fleet nothing.
      read: { content: [{ type: 'text', text: 'You have no person ship in this fleet: your rights there do not let you message' }], isError: true },
    });
    await mcp.close();
  });

  it('is refused when the sign-in finishes in another browser than the one that started it (login CSRF)', async () => {
    pagasae.answer(charlotteIn(fleetId));
    const client = aClientProvider(await aRegisteredClient(setting, false));
    await auth(client.provider, { serverUrl: `${setting.address}/mcp` });

    const landed = await browserFrom(z.instanceof(URL).parse(client.sentTo()), { isKeepingCookies: false });

    expect({ status: landed.status, says: (await landed.text()).includes('another browser') }).toEqual({ status: 400, says: true });
  });

  it('is told when this gateway does not serve the fleet pagasae signed them in to', async () => {
    pagasae.answer(charlotteIn('flt_01m3tb1zgr5h2ffee12xnch8zz'));
    const client = aClientProvider(await aRegisteredClient(setting, false));
    await auth(client.provider, { serverUrl: `${setting.address}/mcp` });

    const landed = await browserFrom(z.instanceof(URL).parse(client.sentTo()));

    expect({ status: landed.status, says: (await landed.text()).includes('does not serve the fleet') }).toEqual({ status: 403, says: true });
  });
});
