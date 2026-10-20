import { idSchema, type FleetId } from '@aeolus-fleet/common';
import { Client, StreamableHTTPClientTransport, auth } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { commission, register, registerNetworkingPlugin, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { aBrowser, pickedAt } from './support/browser.js';
import { charlotteIn, startFakePagasae, PAGASAE_CLIENT, type FakePagasae } from './support/fake-pagasae.js';
import { aFreePort, startFleetServer } from './support/fleet-server.js';
import { connectGateway, mutate, query } from './support/gateway-api.js';
import { aClientProvider, aRegisteredClient, CALLBACK, TEST_GATEWAY_SECRET, type Setting } from './support/mcp-client.js';
import { outsidePartiesOn } from './support/outside-parties.js';

// A person signs in to the gateway through pagasae from their MCP client, as
// Claude would (decision 0054): /authorize asks them to sign in as
// themselves or to ask for access for the client (Q1 a), sends them to
// pagasae, pagasae sends them back, and the client takes the gateway's code
// for tokens, or waits for an approver (decision 0056). Here pagasae is a fake; the fleet and the
// gateway are real.

const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare'];
/** The hosting service's token (decision 0021), which pagasae presents when it tells the gateway an account was disabled. */
const INSTALLATION_TOKEN = 'an-installation-token-of-at-least-32-characters';

let setting: Setting;
let app: GatewayApp;
let pagasae: FakePagasae;
let fleetId: FleetId;

beforeEach(async () => {
  const fleet = await startFleetServer(inject('postgresUrl'));
  const port = await aFreePort();
  const address = `http://127.0.0.1:${String(port)}`;
  pagasae = await startFakePagasae();
  setting = { fleet, address, cookie: await signIn(fleet), databaseUrl: await migratedDatabase(inject('postgresUrl')), pagasae };
  app = createGatewayApp({ databaseUrl: setting.databaseUrl, fleetUrl: fleet.url, logger: false, publicUrl: address, gatewaySecret: TEST_GATEWAY_SECRET, pagasae: { url: pagasae.url, ...PAGASAE_CLIENT }, installationToken: INSTALLATION_TOKEN });
  await app.server.listen({ host: '127.0.0.1', port });
  const gatewayShip = await commission(fleet, { cookie: setting.cookie, ship: { name: 'gateway', type: 'gateway', kind: 'app', scopes: GATEWAY_SCOPES } });
  const probeCrew = await register(fleet, await commission(fleet, { cookie: setting.cookie, ship: { name: 'probe', type: 'agent' } }));
  const whoami = await fetch(`${fleet.url}/api/v1/ship/whoami`, { headers: { authorization: `Bearer ${probeCrew}` } });
  fleetId = z.object({ fleetId: idSchema('fleet') }).parse(await whoami.json()).fleetId;
  await registerNetworkingPlugin(fleet, setting.cookie);
  expect((await mutate(address, { procedure: 'installation.setEnabled', installationToken: INSTALLATION_TOKEN, body: { requestId: 'switch-on', fleetId, enabled: true } })).status).toBe(200);
  expect((await connectGateway(address, { cookie: setting.cookie, ...gatewayShip })).status).toBe(200);
});

afterEach(async () => {
  await app.close();
  await pagasae.stop();
  await setting.fleet.stop();
});

/** Charlotte signs in from a new MCP client, which takes the gateway's tokens. */
async function charlotteSignedIn(): Promise<ReturnType<typeof aClientProvider>> {
  pagasae.answer(charlotteIn(pagasae, fleetId));
  const client = aClientProvider(await aRegisteredClient(setting, false));
  const serverUrl = `${setting.address}/mcp`;
  await auth(client.provider, { serverUrl });
  const back = new URL(z.string().parse((await aBrowser().follow(pickedAt(z.instanceof(URL).parse(client.sentTo()), 'account'), CALLBACK)).headers.get('location')));
  const iss = back.searchParams.get('iss');
  await expect(auth(client.provider, { serverUrl, authorizationCode: z.string().parse(back.searchParams.get('code')), ...(iss === null ? {} : { iss }) })).resolves.toBe('AUTHORIZED');
  return client;
}

/** What /mcp answers an initialize from the client with its access token. */
async function initializeStatus(client: ReturnType<typeof aClientProvider>): Promise<number> {
  const tokens = await client.provider.tokens();
  const response = await fetch(`${setting.address}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${z.string().parse(tokens?.access_token)}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'charlotte', version: '1' } } }),
  });
  await response.body?.cancel();
  return response.status;
}

describe('a person signs in from their MCP client through pagasae', () => {
  it("gets tokens with no approval, and their MCP session lists their person ship's tools", async () => {
    pagasae.answer(charlotteIn(pagasae, fleetId));
    const client = aClientProvider(await aRegisteredClient(setting, false));
    const serverUrl = `${setting.address}/mcp`;
    await expect(auth(client.provider, { serverUrl })).resolves.toBe('REDIRECT');

    const back = new URL(z.string().parse((await aBrowser().follow(pickedAt(z.instanceof(URL).parse(client.sentTo()), 'account'), CALLBACK)).headers.get('location')));
    const iss = back.searchParams.get('iss');
    await expect(auth(client.provider, { serverUrl, authorizationCode: z.string().parse(back.searchParams.get('code')), ...(iss === null ? {} : { iss }) })).resolves.toBe('AUTHORIZED');
    const mcp = new Client({ name: 'charlotte', version: '1' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider: client.provider }));

    const listed = await mcp.listTools();
    const read = await mcp.callTool({ name: 'aeolus_inbox', arguments: {} });

    expect({ tools: listed.tools.map(({ name }) => name), read }).toEqual({
      tools: ['aeolus_inbox', 'aeolus_open', 'aeolus_answer', 'aeolus_done', 'aeolus_ask_for_server'],
      // pagasae names no person ship for Charlotte here, so the gateway asks the fleet nothing.
      read: { content: [{ type: 'text', text: 'You have no person ship in this fleet: your rights there do not let you message' }], isError: true },
    });
    await mcp.close();
  });

  it('is refused when the sign-in finishes in another browser than the one that started it (login CSRF)', async () => {
    pagasae.answer(charlotteIn(pagasae, fleetId));
    const client = aClientProvider(await aRegisteredClient(setting, false));
    await auth(client.provider, { serverUrl: `${setting.address}/mcp` });

    const landed = await aBrowser({ isKeepingCookies: false }).follow(pickedAt(z.instanceof(URL).parse(client.sentTo()), 'account'), CALLBACK);

    expect({ status: landed.status, says: (await landed.text()).includes('another browser') }).toEqual({ status: 400, says: true });
  });

  it('is told when this gateway does not serve the fleet pagasae signed them in to', async () => {
    pagasae.answer(charlotteIn(pagasae, 'flt_01m3tb1zgr5h2ffee12xnch8zz'));
    const client = aClientProvider(await aRegisteredClient(setting, false));
    await auth(client.provider, { serverUrl: `${setting.address}/mcp` });

    const landed = await aBrowser().follow(pickedAt(z.instanceof(URL).parse(client.sentTo()), 'account'), CALLBACK);

    expect({ status: landed.status, says: (await landed.text()).includes('does not serve the fleet') }).toEqual({ status: 403, says: true });
  });
});

describe("a person signs in to the gateway's pages through pagasae", () => {
  /** What the gateway's API answers the browser for the requests to decide, which needs gateway:approve. */
  async function toDecideStatus(browser: ReturnType<typeof aBrowser>): Promise<number> {
    const response = await browser.visit(`${setting.address}/trpc/requests.toDecide`);
    await response.body?.cancel();
    return response.status;
  }

  it('lands on the page they asked for, acting as their account with the scopes their account token carries', async () => {
    pagasae.answer({ ...charlotteIn(pagasae, fleetId), scope: 'fleet:read gateway:approve' });
    const browser = aBrowser();

    const landed = await browser.follow(`${setting.address}/sign-in?return_to=${encodeURIComponent('/overview')}`, `${setting.address}/overview`);

    expect({ status: landed.status, location: landed.headers.get('location') }).toEqual({ status: 302, location: '/overview' });
    expect(landed.headers.getSetCookie().find((cookie) => cookie.startsWith('aeolus_gateway_session='))).toMatch(/^aeolus_gateway_session=[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Lax$/);
    await expect(toDecideStatus(browser)).resolves.toBe(200);
  });

  it('is refused what its account token does not carry the scope for', async () => {
    pagasae.answer(charlotteIn(pagasae, fleetId));
    const browser = aBrowser();
    await browser.follow(`${setting.address}/sign-in`, `${setting.address}/overview`);

    await expect(toDecideStatus(browser)).resolves.toBe(403);
  });

  it('sees the overview as their account, with no person ship to read and a way to sign out', async () => {
    pagasae.answer({ ...charlotteIn(pagasae, fleetId), scope: 'fleet:read gateway:approve' });
    const browser = aBrowser();
    await browser.follow(`${setting.address}/sign-in`, `${setting.address}/overview`);

    const overview = await browser.visit(`${setting.address}/overview`);
    const page = await overview.text();

    // pagasae names no person ship for Charlotte here, so only To decide waits on her.
    expect({ status: overview.status, waits: page.includes('0 to decide') && !page.includes('for you'), signOut: page.includes('action="/sign-out"') }).toEqual({ status: 200, waits: true, signOut: true });
  });

  it('signs out: the page session ends, so the next call is signed out', async () => {
    pagasae.answer({ ...charlotteIn(pagasae, fleetId), scope: 'fleet:read gateway:approve' });
    const browser = aBrowser();
    await browser.follow(`${setting.address}/sign-in`, `${setting.address}/overview`);

    const signedOut = await browser.post(`${setting.address}/sign-out`);

    expect({ status: signedOut.status, location: signedOut.headers.get('location') }).toEqual({ status: 303, location: '/overview' });
    await expect(toDecideStatus(browser)).resolves.toBe(401);
  });
});

describe('a person asks for access for their MCP client (decision 0056)', () => {
  const toDecideSchema = z.object({ result: z.object({ data: z.array(z.object({ requestId: z.string(), subject: z.object({ clientName: z.string() }) })) }) });

  it('waits on the gateway\'s page while an approver sees the request to decide, and the client is told access_denied once it is denied', async () => {
    pagasae.answer(charlotteIn(pagasae, fleetId));
    await outsidePartiesOn(setting.databaseUrl, fleetId);
    const client = aClientProvider(await aRegisteredClient(setting, false));
    await auth(client.provider, { serverUrl: `${setting.address}/mcp` });
    const approver = await register(setting.fleet, await commission(setting.fleet, { cookie: setting.cookie, ship: { name: 'approver', type: 'agent', scopes: ['fleet:read', 'gateway:approve'] } }));
    const browser = aBrowser();

    const landed = await browser.follow(pickedAt(z.instanceof(URL).parse(client.sentTo()), 'party'), CALLBACK);
    const waiting = landed.url;
    const toDecide = toDecideSchema.parse(await (await query(setting.address, { procedure: 'requests.toDecide', crewToken: approver })).json()).result.data;
    const [request] = toDecide;
    const denied = await mutate(setting.address, { procedure: 'requests.decide', crewToken: approver, body: { requestId: request?.requestId, decision: { kind: 'deny' } } });
    const answer = await browser.visit(waiting);

    expect({
      waited: { status: landed.status, isWaitingPage: new URL(waiting).pathname === '/authorize/waiting', says: (await landed.text()).includes('Waiting for approval') },
      toDecide: toDecide.map(({ subject }) => subject.clientName),
      denied: denied.status,
      back: new URL(z.string().parse(answer.headers.get('location'))).searchParams.get('error'),
    }).toEqual({ waited: { status: 200, isWaitingPage: true, says: true }, toDecide: ['Test client'], denied: 200, back: 'access_denied' });
  });
});

describe('a person asks for an outside MCP server from their chat (decision 0056)', () => {
  it('opens a pending request an approver sees to decide', async () => {
    pagasae.answer(charlotteIn(pagasae, fleetId));
    await outsidePartiesOn(setting.databaseUrl, fleetId);
    const approver = await register(setting.fleet, await commission(setting.fleet, { cookie: setting.cookie, ship: { name: 'approver', type: 'agent', scopes: ['fleet:read', 'gateway:approve'] } }));
    const client = aClientProvider(await aRegisteredClient(setting, false));
    const serverUrl = `${setting.address}/mcp`;
    await auth(client.provider, { serverUrl });
    const back = new URL(z.string().parse((await aBrowser().follow(pickedAt(z.instanceof(URL).parse(client.sentTo()), 'account'), CALLBACK)).headers.get('location')));
    const iss = back.searchParams.get('iss');
    await auth(client.provider, { serverUrl, authorizationCode: z.string().parse(back.searchParams.get('code')), ...(iss === null ? {} : { iss }) });
    const mcp = new Client({ name: 'charlotte', version: '1' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider: client.provider }));

    const asked = await mcp.callTool({ name: 'aeolus_ask_for_server', arguments: { url: 'https://mcp.linear.app/mcp' } });
    const listed = await query(setting.address, { procedure: 'requests.toDecide', crewToken: approver });
    await mcp.close();

    expect({
      isAsked: asked.isError !== true,
      toDecide: z.object({ result: z.object({ data: z.array(z.object({ subject: z.unknown(), requesters: z.unknown() })) }) }).parse(await listed.json()).result.data,
    }).toEqual({
      isAsked: true,
      toDecide: [{ subject: { kind: 'server', url: 'https://mcp.linear.app/mcp' }, requesters: [{ accountId: 'acc-charlotte', personShipId: null }] }],
    });
  });
});

describe("pagasae tells the gateway an account was disabled (decision 0055, flow F8)", () => {
  it("refuses the leaver's MCP clients at their next call, with the installation token", async () => {
    const first = await charlotteSignedIn();
    const second = await charlotteSignedIn();
    expect([await initializeStatus(first), await initializeStatus(second)]).toEqual([200, 200]);

    const told = await mutate(setting.address, { procedure: 'installation.accountDisabled', installationToken: INSTALLATION_TOKEN, body: { fleetId, accountId: 'acc-charlotte' } });

    expect({ told: told.status, clients: [await initializeStatus(first), await initializeStatus(second)] }).toEqual({ told: 200, clients: [401, 401] });
  });

  it('is refused without the installation token, and the sign-in goes on', async () => {
    const client = await charlotteSignedIn();

    const told = await mutate(setting.address, { procedure: 'installation.accountDisabled', body: { fleetId, accountId: 'acc-charlotte' } });

    expect({ told: told.status, client: await initializeStatus(client) }).toEqual({ told: 401, client: 200 });
  });
});
