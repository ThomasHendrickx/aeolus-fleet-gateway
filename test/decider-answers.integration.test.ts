/**
 * A Decider added to a fleet answers a builder's agent (hosted onboarding
 * D1, scenarios A10 and A11; gateway#404): the account app's "Talk with the
 * fleet from Claude or ChatGPT" rights, messages:send and messages:receive,
 * and nothing more. Against a real core that trusts a fake account service, through
 * the gateway's own Postgres: from Bridge's API and from their own chat over
 * MCP, the agent that asked receives the answer.
 */
import { idSchema, receiveOutputSchema, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { Client, StreamableHTTPClientTransport, auth } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { commission, register, setOwner } from './support/argo.js';
import { aBrowser, pickedAt } from './support/browser.js';
import { migratedDatabase } from './support/database.js';
import { charlotteIn, PAGASAE_APP_CLIENT, PAGASAE_CLIENT, startFakePagasae, WAKE_INSTALLATION_TOKEN, type FakePagasae } from './support/fake-pagasae.js'; // privacy-guard: allow private-repo
import { aFleetOfTheInstallation, aFreePort, startInstallationServer, type FleetServer } from './support/fleet-server.js';
import { connectGateway, mutate } from './support/gateway-api.js';
import { aClientProvider, aRegisteredClient, CALLBACK, TEST_GATEWAY_SECRET } from './support/mcp-client.js';

/** The account app's "Talk with the fleet from Claude or ChatGPT" bundle, as the account service signs it into the account token. */
const TALK_WITH_THE_FLEET = 'messages:send messages:receive';
const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify'];
const SHARED_SESSION = 'decider-shared-session';
const QUESTION_TYPE = 'application/vnd.aeolus.question+json';
const ANSWER_TYPE = 'application/vnd.aeolus.answer+json';
const QUESTION = {
  id: '3c0f8f0e-9d1b-4a3e-9f7a-1d2c3b4a5e6f',
  title: 'Which time zone do tide alerts use for a harbour on a border?',
  context: 'Two harbours sit on an estuary between two time zones.',
  options: [{ key: 1, label: "The harbour's published zone" }, { key: 2, label: "The user's own zone" }],
  pick: { option: 1, why: 'Harbour masters check alerts against the printed tables.' },
};
const dataOf = <T extends z.ZodType>(schema: T) => z.object({ result: z.object({ data: schema }) });
const homeSchema = dataOf(z.object({ waiting: z.object({ items: z.array(z.object({ deliveryId: idSchema('delivery'), title: z.string() })) }) }));

let service: FakePagasae; // privacy-guard: allow private-repo
let fleet: FleetServer;
let app: GatewayApp;
let address: string;
let fleetId: FleetId;
let fleetCookie: string;
let deciderShipId: ShipId;
let writer: string;

/** The Decider's account token: their person ship, their group, and the bundle's two rights alone. */
function deciderClaims(): Record<string, unknown> {
  return { ...charlotteIn(service, fleetId), sub: 'decider-account', scope: TALK_WITH_THE_FLEET, group: ['deciders'], person_ship: deciderShipId };
}

beforeEach(async () => {
  service = await startFakePagasae({ email: 'decider@example.test', firstName: 'Dana' }); // privacy-guard: allow private-repo
  fleet = await startInstallationServer(inject('postgresUrl'), { installationToken: WAKE_INSTALLATION_TOKEN, accountTokenIssuer: service.url });
  const made = await aFleetOfTheInstallation(fleet, { installationToken: WAKE_INSTALLATION_TOKEN, name: 'builder' });
  fleetId = made.fleetId;
  fleetCookie = made.cookie;
  const decider = await commission(fleet, { cookie: made.cookie, ship: { name: 'person-decider', type: 'person', kind: 'person' } });
  deciderShipId = decider.shipId;
  const agent = await commission(fleet, { cookie: made.cookie, ship: { name: 'writer', type: 'writer', kind: 'agent' } });
  await setOwner(fleet, { cookie: made.cookie, shipId: agent.shipId, ownerShipId: deciderShipId });
  writer = await register(fleet, agent);
  const gateway = await commission(fleet, { cookie: made.cookie, ship: { name: 'gateway', type: 'gateway', kind: 'app', scopes: GATEWAY_SCOPES } });
  service.sharedSignIn(SHARED_SESSION, deciderClaims());
  service.listFor(SHARED_SESSION, [{ id: fleetId, name: 'builder' }]);
  const port = await aFreePort();
  address = `http://127.0.0.1:${String(port)}`;
  app = createGatewayApp({ databaseUrl: await migratedDatabase(inject('postgresUrl')), fleetUrl: fleet.url, publicUrl: address, logger: false, gatewaySecret: TEST_GATEWAY_SECRET, installationToken: WAKE_INSTALLATION_TOKEN, pagasae: { url: service.url, ...PAGASAE_CLIENT }, pagasaeApp: PAGASAE_APP_CLIENT }); // privacy-guard: allow private-repo
  await app.server.listen({ host: '127.0.0.1', port });
  expect((await mutate(address, { procedure: 'installation.setEnabled', installationToken: WAKE_INSTALLATION_TOKEN, body: { requestId: 'serve-builder', fleetId, enabled: true } })).status).toBe(200);
  const connected = await connectGateway(address, { cookie: made.cookie, ...gateway });
  expect(connected.status, await connected.clone().text()).toBe(200);
});

afterEach(async () => {
  await app.close();
  await service.stop();
  await fleet.stop();
});

/** The writer asks the Decider's person ship, as the builder's agent does with `ask`. */
async function writerAsks(): Promise<MessageId> {
  const sent = await fetch(`${fleet.url}/api/v1/ship/send`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${writer}` }, body: JSON.stringify({ selector: { kind: 'ship', shipId: deciderShipId }, contentType: QUESTION_TYPE, payload: JSON.stringify(QUESTION), model: 'test-writer', idempotencyKey: QUESTION.id }) });
  expect(sent.status, await sent.clone().text()).toBe(200);
  return z.object({ messageId: idSchema('message') }).parse(await sent.json()).messageId;
}

/** What reaches the writer: the answers, by what they reply to and say. */
async function writerReceives() {
  const received = await fetch(`${fleet.url}/api/v1/ship/receive`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${writer}` }, body: JSON.stringify({ max: 10 }) });
  return receiveOutputSchema.parse(await received.json()).deliveries.map(({ senderShipId, inReplyTo, contentType, payload }) => ({ senderShipId, inReplyTo, contentType, payload }));
}

/** A call of the gateway's API from Bridge's server, with the Decider's shared sign-in. */
function bridgeCall(procedure: string, body?: unknown): Promise<Response> {
  const headers = { 'content-type': 'application/json', cookie: `aeolus_account_session=${SHARED_SESSION}`, 'aeolus-fleet': fleetId };
  return fetch(`${address}/trpc/${procedure}`, body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('a Decider with only the "Talk with the fleet" rights (A10, gateway#404)', () => {
  it('opens the question in Bridge, answers it, and the writer receives the answer in reply', async () => {
    const asked = await writerAsks();
    const home = homeSchema.parse(await (await bridgeCall('people.home')).json()).result.data;
    const deliveryId = home.waiting.items[0]?.deliveryId;

    const opened = await bridgeCall('people.open', { deliveryId });
    const answered = await bridgeCall('people.answer', { deliveryId, contentType: ANSWER_TYPE, payload: JSON.stringify({ questionId: QUESTION.id, option: 1 }) });

    expect({ opened: opened.status, answered: answered.status, received: await writerReceives() }).toEqual({
      opened: 200,
      answered: 200,
      received: [{ senderShipId: deciderShipId, inReplyTo: asked, contentType: ANSWER_TYPE, payload: JSON.stringify({ questionId: QUESTION.id, option: 1 }) }],
    });
  });
});

describe('a Decider answering from their own chat through the gateway connector (A11)', () => {
  it('opens the same question over MCP, answers it, and the writer receives the answer in reply', async () => {
    const asked = await writerAsks();
    service.answer(deciderClaims());
    const client = aClientProvider(await aRegisteredClient({ fleet, address, cookie: fleetCookie, databaseUrl: '', pagasae: service }, false)); // privacy-guard: allow private-repo
    const serverUrl = `${address}/mcp`;
    await auth(client.provider, { serverUrl });
    const back = new URL(z.string().parse((await aBrowser().follow(pickedAt(z.instanceof(URL).parse(client.sentTo()), 'account'), CALLBACK)).headers.get('location')));
    const iss = back.searchParams.get('iss');
    await auth(client.provider, { serverUrl, authorizationCode: z.string().parse(back.searchParams.get('code')), ...(iss === null ? {} : { iss }) });
    const mcp = new Client({ name: 'claude.ai', version: '1' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider: client.provider }));
    const deliveryId = z.string().parse((/dlv_[0-9a-z]+/.exec(JSON.stringify(await mcp.callTool({ name: 'aeolus_inbox', arguments: {} }))))?.[0]);

    const opened = await mcp.callTool({ name: 'aeolus_open', arguments: { deliveryId } });
    const answered = await mcp.callTool({ name: 'aeolus_answer', arguments: { deliveryId, contentType: ANSWER_TYPE, payload: JSON.stringify({ questionId: QUESTION.id, option: 1 }) } });
    await mcp.close();

    expect({ isOpenRefused: opened.isError === true, isAnswerRefused: answered.isError === true, received: await writerReceives() }).toEqual({
      isOpenRefused: false,
      isAnswerRefused: false,
      received: [{ senderShipId: deciderShipId, inReplyTo: asked, contentType: ANSWER_TYPE, payload: JSON.stringify({ questionId: QUESTION.id, option: 1 }) }],
    });
  });
});
