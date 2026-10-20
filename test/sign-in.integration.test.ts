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
