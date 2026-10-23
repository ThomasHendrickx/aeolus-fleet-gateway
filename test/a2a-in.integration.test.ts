import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createShipAliases } from '../src/adapters/crypto/ship-aliases.js';
import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { commission, register, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { startFakePagasae } from './support/fake-pagasae.js';
import { aFreePort, startFleetServer } from './support/fleet-server.js';
import { mutate, query } from './support/gateway-api.js';
import { aConnectedGateway, fleetIdOf, TEST_GATEWAY_SECRET, type Setting } from './support/mcp-client.js';
import { outsidePartiesOn } from './support/outside-parties.js';
import { receiveOne } from './support/ship.js';

// A2A in (decision 0060): an approver adds an outside A2A client, and the
// client reads the cards of the ships its proxy ship reaches, by alias. The
// fleet and the gateway are real.

let setting: Setting;
let app: GatewayApp;
/** The crew token of a ship holding gateway:approve and fleet:read. */
let approver: string;
let owner: ShipId;
let port: number;

/** A blocking send waits at most this long in these tests: long enough for a reply to travel, short for the sends nobody answers. */
const WAIT_MAX_MS = 3000;

/** The gateway, started on the test's port against its database and fleet. */
async function startedGateway(): Promise<GatewayApp> {
  const started = createGatewayApp({ databaseUrl: setting.databaseUrl, fleetUrl: setting.fleet.url, logger: false, publicUrl: setting.address, gatewaySecret: TEST_GATEWAY_SECRET, mcpWaitMaxMs: WAIT_MAX_MS });
  await started.server.listen({ host: '127.0.0.1', port });
  return started;
}

beforeEach(async () => {
  const fleet = await startFleetServer(inject('postgresUrl'));
  port = await aFreePort();
  const address = `http://127.0.0.1:${String(port)}`;
  setting = { fleet, address, cookie: await signIn(fleet), databaseUrl: await migratedDatabase(inject('postgresUrl')), pagasae: await startFakePagasae() };
  app = await startedGateway();
  await aConnectedGateway(setting);
  owner = (await commission(fleet, { cookie: setting.cookie, ship: { name: 'person-owner', type: 'person', kind: 'person' } })).shipId;
  approver = await register(fleet, await commission(fleet, { cookie: setting.cookie, ship: { name: 'approver', type: 'agent', scopes: ['fleet:read', 'gateway:approve'] } }));
  await outsidePartiesOn(setting.databaseUrl, await fleetIdOf(setting));
});

afterEach(async () => {
  await app.close();
  await setting.pagasae.stop();
  await setting.fleet.stop();
});

const addedSchema = z.object({ result: z.object({ data: z.object({ party: z.object({ proxyShipId: z.string() }), bearer: z.string() }) }) });

/** The approver adds the supplier's A2A client: the answer as the API gave it. */
function addSupplier(requestId = crypto.randomUUID()): Promise<Response> {
  return mutate(setting.address, { procedure: 'parties.addA2aClient', crewToken: approver, body: { requestId, name: 'supplier', ownerShipId: owner, scopes: ['fleet:read'] } });
}

/** A ship of the fleet that states one capability taking plain text, with the timing given, as its crew: its id and crew token. */
async function aStatingShip(timing: { waitMs?: number; deadlineMs?: number } = {}): Promise<{ shipId: ShipId; crewToken: string }> {
  const ship = await commission(setting.fleet, { cookie: setting.cookie, ship: { name: 'procurement', type: 'procurement', kind: 'app' } });
  const crewToken = await register(setting.fleet, ship);
  const stated = await fetch(`${setting.fleet.url}/api/v1/ship/setStatement`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` },
    body: JSON.stringify({ summary: 'Procurement: purchase orders.', capabilities: [{ name: 'quote', description: 'Takes a quote for an order.', inputModes: ['text/plain'], ...timing }] }),
  });
  expect(stated.status).toBe(200);
  return { shipId: ship.shipId, crewToken };
}

/** The card addresses the supplier's detail lists. */
async function cardAddresses(): Promise<string[]> {
  const read = await query(setting.address, { procedure: 'parties.cardAddresses', cookie: setting.cookie, input: { name: 'supplier' } });
  return z.object({ result: z.object({ data: z.object({ addresses: z.array(z.string()) }) }) }).parse(await read.json()).result.data.addresses;
}

/** GetExtendedAgentCard at an alias's interface, with the bearer. */
function extendedCard(interfaceUrl: string, bearer: string): Promise<Response> {
  return fetch(interfaceUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}`, 'a2a-version': '1.0' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'GetExtendedAgentCard', params: {} }),
  });
}

describe('an approver adds an outside A2A client', () => {
  it('commissions an a2a-client proxy ship with the owner and scopes chosen, and shows a bearer once', async () => {
    const added = await addSupplier();
    expect(added.status, await added.clone().text()).toBe(200);
    const { party, bearer } = addedSchema.parse(await added.json()).result.data;

    const ship = await fetch(`${setting.fleet.url}/api/v1/fleet/ship`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${approver}` }, body: JSON.stringify({ shipId: party.proxyShipId }) });
    const read = await query(setting.address, { procedure: 'parties.get', cookie: setting.cookie, input: { name: 'supplier' } });

    const detail = await read.text();

    expect(await ship.json()).toMatchObject({ name: 'supplier', type: 'a2a-client', kind: 'app' });
    const shown = z.object({ result: z.object({ data: z.object({ kind: z.string(), state: z.string(), ownerShipId: z.string().nullable(), scopes: z.array(z.string()).nullable() }) }) }).parse(JSON.parse(detail)).result.data;
    expect({ ...shown, hasRead: shown.scopes?.includes('fleet:read') }).toMatchObject({ kind: 'a2aClient', state: 'crewed', ownerShipId: owner, hasRead: true });
    expect(bearer).toMatch(/^\S{32,}$/);
    expect(detail).not.toContain(bearer);
  });

  it("adds nothing while the fleet's outside parties are off, and refuses every A2A call", async () => {
    const added = addedSchema.parse(await (await addSupplier()).json()).result.data;
    await aStatingShip();
    const [address = ''] = await cardAddresses();
    const off = await mutate(setting.address, { procedure: 'outsideParties.set', cookie: setting.cookie, body: { isOn: false, isOpenNetworkConfirmed: false } });
    expect(off.status, await off.clone().text()).toBe(200);

    const again = await mutate(setting.address, { procedure: 'parties.addA2aClient', crewToken: approver, body: { requestId: crypto.randomUUID(), name: 'another', ownerShipId: owner, scopes: [] } });
    const called = await extendedCard(address.replace('/.well-known/agent-card.json', ''), added.bearer);

    expect({ added: again.status, called: called.status }).toEqual({ added: 412, called: 403 });
  });
});

describe('an outside A2A client reads the cards of the ships its proxy ship reaches', () => {
  it("lists a card address per reachable ship on the party's detail, and serves its public card with no skills", async () => {
    await addSupplier();
    await aStatingShip();

    const addresses = await cardAddresses();
    const cards = await Promise.all(addresses.map(async (address) => z.record(z.string(), z.unknown()).parse(await (await fetch(address)).json())));

    expect(addresses.every((address) => new RegExp(`^${setting.address}/gw/a2a/[a-z][a-z2-7]{7}/\\.well-known/agent-card\\.json$`).test(address))).toBe(true);
    expect(addresses.length).toBeGreaterThan(0);
    expect(cards.map((card) => ({ hasSkills: 'skills' in card, capabilities: card.capabilities }))).toEqual(cards.map(() => ({ hasSkills: false, capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: true } })));
    expect(JSON.stringify(cards)).not.toContain('procurement');
  });

  it("answers the reachable ship's statement as its extended card", async () => {
    const { bearer } = addedSchema.parse(await (await addSupplier()).json()).result.data;
    await aStatingShip();
    const publicCards = await Promise.all((await cardAddresses()).map(async (address) => z.object({ supportedInterfaces: z.array(z.object({ url: z.string() })) }).parse(await (await fetch(address)).json())));

    const extended = await Promise.all(publicCards.map(async (card) => z.object({ result: z.object({ description: z.string(), skills: z.array(z.object({ id: z.string() })).optional() }) }).parse(await (await extendedCard(card.supportedInterfaces[0]?.url ?? '', bearer)).json())));

    expect(extended.map(({ result }) => result)).toContainEqual(expect.objectContaining({ description: 'Procurement: purchase orders.', skills: [expect.objectContaining({ id: 'quote' })] }));
  });

  it('answers the unknown-alias error for an alias of no ship', async () => {
    const { bearer } = addedSchema.parse(await (await addSupplier()).json()).result.data;

    const called = await extendedCard(`${setting.address}/gw/a2a/azzzzzzz`, bearer);

    expect(called.status).toBe(404);
  });
});

/** A call of the ship's crew to the fleet: its answer. */
async function asShip(crewToken: string, call: { path: string; body: unknown }): Promise<unknown> {
  const response = await fetch(`${setting.fleet.url}/api/v1${call.path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` }, body: JSON.stringify(call.body) });
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json();
}

/** The ship replies to a message, as its crew. */
async function replyTo(crewToken: string, reply: { to: string; inReplyTo: string; contentType?: string; payload: string }): Promise<void> {
  const body = { selector: { kind: 'ship', shipId: reply.to }, inReplyTo: reply.inReplyTo, contentType: reply.contentType ?? 'text/plain', payload: reply.payload, idempotencyKey: crypto.randomUUID() };
  await asShip(crewToken, { path: '/ship/send', body });
}

const rpcAnswerSchema = z.object({ result: z.record(z.string(), z.unknown()).optional(), error: z.object({ code: z.number() }).optional() });
const taskSchema = z.object({ id: z.string(), contextId: z.string(), status: z.object({ state: z.string() }), artifacts: z.array(z.object({ parts: z.array(z.record(z.string(), z.unknown())) })).optional() });

describe("an outside A2A client's message is a message its proxy ship sends (decision 0060)", () => {
  let bearer: string;
  let supplierShipId: string;
  let procurement: { shipId: ShipId; crewToken: string };
  let interfaceUrl: string;

  /** The supplier's client and the procurement ship it reaches, its capability with the timing given. */
  async function aSupplierReaching(timing: { waitMs?: number; deadlineMs?: number } = {}): Promise<void> {
    const added = addedSchema.parse(await (await addSupplier()).json()).result.data;
    bearer = added.bearer;
    supplierShipId = added.party.proxyShipId;
    procurement = await aStatingShip(timing);
    const fleetId: FleetId = await fleetIdOf(setting);
    interfaceUrl = `${setting.address}/gw/a2a/${createShipAliases(TEST_GATEWAY_SECRET).aliasOf(fleetId, procurement.shipId)}`;
  }

  /** A JSON-RPC call at the procurement alias's interface, as the supplier's client. */
  async function rpc(method: string, params: Record<string, unknown>): Promise<z.infer<typeof rpcAnswerSchema>> {
    const answered = await fetch(interfaceUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}`, 'a2a-version': '1.0' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    return rpcAnswerSchema.parse(await answered.json());
  }

  /** SendMessage of one text part, at once unless blocking: the task answered. */
  async function sent(message: { messageId: string; text: string; taskId?: string; mediaType?: string }, isBlocking = false): Promise<z.infer<typeof taskSchema>> {
    const { text, mediaType, ...ids } = message;
    const answered = await rpc('SendMessage', { message: { ...ids, role: 'ROLE_USER', parts: [{ text, ...(mediaType === undefined ? {} : { mediaType }) }] }, configuration: { returnImmediately: !isBlocking } });
    return taskSchema.parse(z.object({ task: z.unknown() }).parse(answered.result).task);
  }

  const taskNow = async (taskId: string) => taskSchema.parse((await rpc('GetTask', { id: taskId })).result);

  it("sends the message to the alias's ship as the proxy ship, once for the same messageId, and answers the same task", async () => {
    await aSupplierReaching();

    const [first, again] = [await sent({ messageId: 'm-1', text: 'Quote 40 chairs.' }), await sent({ messageId: 'm-1', text: 'Quote 40 chairs.' })];
    const deliveries = z.object({ deliveries: z.array(z.object({ senderShipId: z.string(), payload: z.string() })) }).parse(await asShip(procurement.crewToken, { path: '/ship/receive', body: { max: 10 } })).deliveries;

    expect({ again: again.id, deliveries }).toEqual({ again: first.id, deliveries: [expect.objectContaining({ senderShipId: supplierShipId, payload: 'Quote 40 chairs.' })] });
    expect(first.status.state).toBe('TASK_STATE_SUBMITTED');
  });

  it('answers an A2A error and keeps no task when the fleet refuses the send', async () => {
    await aSupplierReaching();

    const answered = await rpc('SendMessage', { message: { messageId: 'm-1', role: 'ROLE_USER', parts: [{ text: 'Quote 40 chairs.', mediaType: 'not a media type' }] } });

    expect({ error: answered.error, tasks: (await rpc('ListTasks', {})).result?.['tasks'] }).toEqual({ error: expect.objectContaining({ code: -32603 }), tasks: [] });
  });

  it('answers no task while the fleet does not answer', async () => {
    await aSupplierReaching();
    await setting.fleet.stop();

    const answered = await fetch(interfaceUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}`, 'a2a-version': '1.0' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: { messageId: 'm-1', role: 'ROLE_USER', parts: [{ text: 'Quote 40 chairs.' }] } } }) });

    expect(answered.status).toBe(502);
    expect(await answered.text()).not.toContain('"task"');
  });

  it("completes the task with the ship's reply, which a blocking send waits for", async () => {
    await aSupplierReaching({ waitMs: WAIT_MAX_MS });
    const replied = (async () => {
      const delivery = await receiveOne(setting.fleet, procurement.crewToken);
      await replyTo(procurement.crewToken, { to: supplierShipId, inReplyTo: delivery?.messageId ?? '', payload: '40 chairs: 2000 euros.' });
    })();

    const task = await sent({ messageId: 'm-1', text: 'Quote 40 chairs.' }, true);
    await replied;

    const completed = task.status.state === 'TASK_STATE_COMPLETED' ? task : await taskNow(task.id);
    expect({ state: completed.status.state, parts: completed.artifacts?.[0]?.parts }).toEqual({ state: 'TASK_STATE_COMPLETED', parts: [{ text: '40 chairs: 2000 euros.', mediaType: 'text/plain' }] });
  });

  it("fails the task at its capability's deadline", async () => {
    await aSupplierReaching({ deadlineMs: 1000 });

    const task = await sent({ messageId: 'm-1', text: 'Quote 40 chairs.' });

    await expect.poll(async () => (await taskNow(task.id)).status.state).toBe('TASK_STATE_FAILED');
  });

  it('fails the task once the fleet gave its delivery up, as sentMessage says', { timeout: 60_000 }, async () => {
    await aSupplierReaching();
    const task = await sent({ messageId: 'm-1', text: 'Quote 40 chairs.' });

    // Retiring the ship abandons its deliveries.
    const retired = await fetch(`${setting.fleet.url}/trpc/fleet.retire`, { method: 'POST', headers: { 'content-type': 'application/json', origin: setting.fleet.url, cookie: setting.cookie }, body: JSON.stringify({ shipId: procurement.shipId }) });
    expect(retired.status, await retired.clone().text()).toBe(200);

    await expect.poll(async () => (await taskNow(task.id)).status.state, { timeout: 50_000, interval: 1000 }).toBe('TASK_STATE_FAILED');
  });

  it("continues a task the ship asked a question in, in reply to the question", async () => {
    await aSupplierReaching();
    const task = await sent({ messageId: 'm-1', text: 'Quote 40 chairs.' });
    const delivery = await receiveOne(setting.fleet, procurement.crewToken);
    await replyTo(procurement.crewToken, { to: supplierShipId, inReplyTo: delivery?.messageId ?? '', contentType: 'application/vnd.aeolus.question+json', payload: JSON.stringify({ id: crypto.randomUUID(), title: 'Which colour?', context: 'The chairs come in two colours.', options: [{ key: 1, label: 'Red' }, { key: 2, label: 'Blue' }] }) });
    await expect.poll(async () => (await taskNow(task.id)).status.state).toBe('TASK_STATE_INPUT_REQUIRED');

    const continued = await sent({ messageId: 'm-2', text: 'Blue.', taskId: task.id });
    const followUp = await receiveOne(setting.fleet, procurement.crewToken);

    expect({ taskId: continued.id, contextId: continued.contextId, payload: followUp?.payload, isInReplyToQuestion: followUp?.inReplyTo !== delivery?.messageId && followUp?.inReplyTo !== undefined }).toEqual({ taskId: task.id, contextId: task.contextId, payload: 'Blue.', isInReplyToQuestion: true });
  });

  it('loses no reply that came while the gateway was down', async () => {
    await aSupplierReaching();
    const task = await sent({ messageId: 'm-1', text: 'Quote 40 chairs.' });
    const delivery = await receiveOne(setting.fleet, procurement.crewToken);
    await app.close();

    await replyTo(procurement.crewToken, { to: supplierShipId, inReplyTo: delivery?.messageId ?? '', payload: '40 chairs: 2000 euros.' });
    app = await startedGateway();

    await expect.poll(async () => (await taskNow(task.id)).status.state).toBe('TASK_STATE_COMPLETED');
  });

  it('sends a message and reads its task over HTTP+JSON', async () => {
    await aSupplierReaching();
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${bearer}`, 'a2a-version': '1.0' };

    const answered = await fetch(`${interfaceUrl}/message:send`, { method: 'POST', headers, body: JSON.stringify({ message: { messageId: 'm-1', role: 'ROLE_USER', parts: [{ text: 'Quote 40 chairs.' }] }, configuration: { returnImmediately: true } }) });
    const { task } = z.object({ task: taskSchema }).parse(await answered.json());
    const read = await fetch(`${interfaceUrl}/tasks/${task.id}`, { headers });

    expect({ status: read.status, task: taskSchema.parse(await read.json()).id }).toEqual({ status: 200, task: task.id });
  });
});
