import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { CRM_SHIP_ID, MESSAGE_ID, aCallReply, aDiscoveredShip, fakeCallKeys, fakeCallSender, fakeDiscovery, memoryClientCalls } from '../../../test/support/mcp-in-fakes.js';
import { ISSUER, fakeSecrets } from '../../../test/support/oauth-fakes.js';
import { PROXY_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import { createAuthenticateA2aClient } from '../../core/a2a-in/authenticate-a2a-client.js';
import { createFindReachedShip } from '../../core/a2a-in/find-reached-ship.js';
import { createListA2aTasks } from '../../core/a2a-in/list-a2a-tasks.js';
import { createListReachedShips } from '../../core/a2a-in/list-reached-ships.js';
import { createReadA2aTask } from '../../core/a2a-in/read-a2a-task.js';
import { createSendA2aMessage } from '../../core/a2a-in/send-a2a-message.js';
import { createShipAliases } from '../crypto/ship-aliases.js';
import { registerA2aEndpoint } from './a2a-endpoint.js';

const AT = new Date('2026-10-23T10:00:00.000Z');
const aliases = createShipAliases('gateway-secret');
const CRM_ALIAS = aliases.aliasOf(FLEET_ID, CRM_SHIP_ID);
/** A well-formed alias of no ship. */
const NO_SHIP_ALIAS = 'azzzzzzz';
const BEARER = { authorization: 'Bearer bearer-1' };
const GET_EXTENDED_CARD = { jsonrpc: '2.0', id: 1, method: 'GetExtendedAgentCard', params: {} };

let server: FastifyInstance;
let isOn: boolean;
let discovery: ReturnType<typeof fakeDiscovery>;
let sender: ReturnType<typeof fakeCallSender>;
let calls: ReturnType<typeof memoryClientCalls>;
let now: Date;

beforeEach(async () => {
  isOn = true;
  const parties = memoryPartyStore();
  await parties.save({ fleetId: FLEET_ID, name: 'supplier', kind: 'a2aClient', bearerHash: 'hash(bearer-1)', state: 'crewed', proxyShipId: PROXY_SHIP_ID, secret: null, crewToken: 'aeolus_ct_v1_proxy', requestId: 'r-1', requestHash: 'h', approvedAt: AT });
  await parties.save({ fleetId: FLEET_ID, name: 'other', kind: 'a2aClient', bearerHash: 'hash(bearer-2)', state: 'crewed', proxyShipId: PROXY_SHIP_ID, secret: null, crewToken: 'aeolus_ct_v1_other', requestId: 'r-2', requestHash: 'h', approvedAt: AT });
  discovery = fakeDiscovery();
  sender = fakeCallSender();
  calls = memoryClientCalls();
  now = AT;
  const clock = { now: () => now };
  const findReachedShip = createFindReachedShip({ listReachedShips: createListReachedShips({ parties, discovery, aliases }) });
  server = Fastify();
  registerA2aEndpoint(server, {
    issuer: ISSUER,
    authenticate: createAuthenticateA2aClient({ parties, secrets: fakeSecrets(), servesOutsideParties: () => Promise.resolve(isOn) }),
    findReachedShip,
    sendMessage: createSendA2aMessage({ parties, findReachedShip, sender, calls, keys: fakeCallKeys(), clock, sleep: () => Promise.resolve(), waitMaxMs: 30_000, waitPollMs: 250 }),
    readTask: createReadA2aTask({ calls, clock }),
    listTasks: createListA2aTasks({ calls, clock }),
  });
  await server.ready();
});

afterEach(async () => {
  await server.close();
});

const extendedCard = (alias: string, headers: Record<string, string> = BEARER) => server.inject({ method: 'POST', url: `/gw/a2a/${alias}`, headers: { ...headers, 'a2a-version': '1.0' }, payload: GET_EXTENDED_CARD });

describe('the public card per alias (decision 0060)', () => {
  it('names the gateway as provider and states the interface, the bearer scheme and an extended card, with no summary and no skills', async () => {
    const answered = await server.inject({ method: 'GET', url: `/gw/a2a/${CRM_ALIAS}/.well-known/agent-card.json` });

    expect(answered.statusCode).toBe(200);
    expect(answered.json()).toMatchObject({
      name: CRM_ALIAS,
      supportedInterfaces: [{ url: `${ISSUER}/gw/a2a/${CRM_ALIAS}`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
      provider: { organization: 'Aeolus gateway', url: ISSUER },
      capabilities: { extendedAgentCard: true },
      securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: 'Bearer' } } },
      securityRequirements: [{ schemes: { bearer: {} } }],
    });
    expect(answered.json()).not.toHaveProperty('skills');
    expect(JSON.stringify(answered.json())).not.toContain('The CRM');
  });

  it('is served the same for an alias of no ship, so it tells nothing', async () => {
    const [crm, none] = await Promise.all([CRM_ALIAS, NO_SHIP_ALIAS].map((alias) => server.inject({ method: 'GET', url: `/gw/a2a/${alias}/.well-known/agent-card.json` })));

    expect(none?.json()).toEqual({ ...crm?.json(), name: NO_SHIP_ALIAS, supportedInterfaces: [{ url: `${ISSUER}/gw/a2a/${NO_SHIP_ALIAS}`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }] });
  });

  it('is not found for a path that is no alias', async () => {
    const answered = await server.inject({ method: 'GET', url: '/gw/a2a/CRM/.well-known/agent-card.json' });

    expect(answered.statusCode).toBe(404);
  });
});

describe('GetExtendedAgentCard (decision 0060)', () => {
  it("answers the statement of a reachable alias's ship for that caller: its summary, its capabilities as skills", async () => {
    const answered = await extendedCard(CRM_ALIAS);

    expect(answered.statusCode).toBe(200);
    expect(answered.json()).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        name: CRM_ALIAS,
        description: 'The CRM: contacts and deals.',
        skills: [
          {
            id: 'list_deals',
            name: 'List deals',
            description: "Lists a contact's deals.",
            inputModes: ['application/vnd.aeolus.mcp-tool+json; name=list_deals'],
            outputModes: ['application/vnd.aeolus.mcp-result+json; name=list_deals'],
          },
        ],
      },
    });
    expect(discovery.askedWith).toEqual(['aeolus_ct_v1_proxy']);
  });

  it('answers the unknown-alias error for an alias of no ship', async () => {
    const answered = await extendedCard(NO_SHIP_ALIAS);

    expect(answered.statusCode).toBe(404);
  });

  it('answers the same for an alias of a ship the caller cannot reach now', async () => {
    discovery.state.ships = [];
    const [unreachable, none] = [await extendedCard(CRM_ALIAS), await extendedCard(NO_SHIP_ALIAS)];

    expect({ status: unreachable.statusCode, body: unreachable.body }).toEqual({ status: none.statusCode, body: none.body });
  });

  it('refuses a call with no bearer, saying it takes one', async () => {
    const answered = await extendedCard(CRM_ALIAS, {});

    expect(answered.statusCode).toBe(401);
    expect(answered.headers['www-authenticate']).toBe('Bearer');
  });

  it('refuses a bearer no client was shown', async () => {
    const answered = await extendedCard(CRM_ALIAS, { authorization: 'Bearer bearer-3' });

    expect(answered.statusCode).toBe(401);
  });

  it("refuses every call while the fleet's outside parties are off", async () => {
    isOn = false;

    const answered = await extendedCard(CRM_ALIAS);

    expect(answered.statusCode).toBe(403);
    expect(discovery.askedWith).toEqual([]);
  });

  it('answers a fleet that does not answer as a bad gateway', async () => {
    discovery.state.refusal = { code: 'UNAVAILABLE', message: 'down' };

    const answered = await extendedCard(CRM_ALIAS);

    expect(answered.statusCode).toBe(502);
  });

  it("answers a ship with no crew's statement with the public card's description and no skills", async () => {
    discovery.state.ships = [aDiscoveredShip({ statement: null })];

    const answered = await extendedCard(CRM_ALIAS);

    expect(answered.json()).toMatchObject({ result: { name: CRM_ALIAS } });
    expect(answered.json()).not.toHaveProperty('result.skills');
  });

  it('answers an A2A method this gateway does not carry yet as an unsupported operation', async () => {
    const answered = await server.inject({ method: 'POST', url: `/gw/a2a/${CRM_ALIAS}`, headers: { ...BEARER, 'a2a-version': '1.0' }, payload: { jsonrpc: '2.0', id: 2, method: 'GetTaskPushNotificationConfig', params: { taskId: 'task-1', id: 'c-1' } } });

    expect(answered.json()).toMatchObject({ jsonrpc: '2.0', id: 2, error: { code: -32004 } });
  });

  it('answers a streaming A2A method this gateway does not carry yet as an unsupported operation', async () => {
    const message = { messageId: 'm-1', role: 'ROLE_USER', parts: [{ text: 'hello' }] };
    const answered = await server.inject({ method: 'POST', url: `/gw/a2a/${CRM_ALIAS}`, headers: { ...BEARER, 'a2a-version': '1.0' }, payload: { jsonrpc: '2.0', id: 3, method: 'SendStreamingMessage', params: { message } } });

    expect(answered.json()).toMatchObject({ jsonrpc: '2.0', id: 3, error: { code: -32004 } });
  });
});

const TASK_ID = `handle(${FLEET_ID}:${MESSAGE_ID})`;
const A_MESSAGE = { messageId: 'm-1', role: 'ROLE_USER', parts: [{ text: 'Quote 40 chairs.' }] };

/** A JSON-RPC call to the alias's interface, as the bearer's client, at A2A 1.0 unless the headers say otherwise. */
const rpc = (method: string, params: Record<string, unknown>, headers: Record<string, string> = { ...BEARER, 'a2a-version': '1.0' }) =>
  server.inject({ method: 'POST', url: `/gw/a2a/${CRM_ALIAS}`, headers, payload: { jsonrpc: '2.0', id: 7, method, params } });

/** An HTTP+JSON call to the alias's interface, as the bearer's client, at A2A 1.0. */
const rest = (method: 'GET' | 'POST', path: string, payload?: Record<string, unknown>, headers: Record<string, string> = BEARER) =>
  server.inject({ method, url: `/gw/a2a/${CRM_ALIAS}${path}`, headers: { ...headers, 'a2a-version': '1.0' }, ...(payload === undefined ? {} : { payload }) });

const sendingTheMessage = () => rpc('SendMessage', { message: A_MESSAGE });

describe('SendMessage over JSON-RPC (decision 0060)', () => {
  it("answers the task once the fleet's send answered OK, its id the HMAC of the msg_ id, the client's message in its history", async () => {
    const answered = await sendingTheMessage();

    expect(answered.json()).toMatchObject({
      jsonrpc: '2.0',
      id: 7,
      result: { task: { id: TASK_ID, contextId: `context(${FLEET_ID}:${MESSAGE_ID})`, status: { state: 'TASK_STATE_SUBMITTED' }, history: [{ messageId: 'm-1', role: 'ROLE_USER', parts: [{ text: 'Quote 40 chairs.' }] }] } },
    });
    expect(sender.sent).toEqual([{ crewToken: 'aeolus_ct_v1_proxy', to: CRM_SHIP_ID, contentType: 'text/plain', payload: 'Quote 40 chairs.', idempotencyKey: `key(${FLEET_ID}:supplier:m-1)` }]);
  });

  it('answers an A2A error and keeps no task when the fleet refuses the send', async () => {
    sender.state.refusal = { code: 'NOT_REACHABLE', message: 'No rule matches' };

    const answered = await sendingTheMessage();

    expect(answered.json()).toMatchObject({ id: 7, error: { code: -32603 } });
    expect(calls.tasks).toEqual([]);
  });

  it('answers an A2A error when the fleet does not answer, so the client sends again', async () => {
    sender.state.refusal = { code: 'UNAVAILABLE', message: 'down' };

    const answered = await sendingTheMessage();

    expect(answered.json()).toMatchObject({ id: 7, error: { code: -32603 } });
    expect(calls.tasks).toEqual([]);
  });

  it('refuses a payload over 64 KB as invalid params, sending nothing', async () => {
    const answered = await rpc('SendMessage', { message: { ...A_MESSAGE, parts: [{ text: 'x'.repeat(65_537) }] } });

    expect(answered.json()).toMatchObject({ id: 7, error: { code: -32602 } });
    expect(sender.sent).toEqual([]);
  });

  it('refuses a call with no A2A-Version, or one it does not speak, sending nothing', async () => {
    const [missing, unsupported] = [await rpc('SendMessage', { message: A_MESSAGE }, BEARER), await rpc('SendMessage', { message: A_MESSAGE }, { ...BEARER, 'a2a-version': '0.3' })];

    expect([missing.json(), unsupported.json()]).toMatchObject([{ error: { code: -32009 } }, { error: { code: -32009 } }]);
    expect(sender.sent).toEqual([]);
  });

  it('refuses a message continuing a task that ended', async () => {
    await sendingTheMessage();
    await calls.addReply({ fleetId: FLEET_ID, messageId: MESSAGE_ID }, aCallReply({ receivedAt: AT }));

    const answered = await rpc('SendMessage', { message: { ...A_MESSAGE, messageId: 'm-2', taskId: TASK_ID } });

    expect(answered.json()).toMatchObject({ id: 7, error: { code: -32004 } });
  });

  it('refuses a message continuing a task of no call of this client as not found', async () => {
    const answered = await rpc('SendMessage', { message: { ...A_MESSAGE, taskId: 'task-1' } });

    expect(answered.json()).toMatchObject({ id: 7, error: { code: -32001 } });
  });
});

describe('GetTask over JSON-RPC (decision 0060, interop 3.4)', () => {
  it("answers the task completed by the ship's reply, the reply as its artifact and in its history", async () => {
    await sendingTheMessage();
    await calls.addReply({ fleetId: FLEET_ID, messageId: MESSAGE_ID }, aCallReply({ receivedAt: new Date('2026-10-23T10:00:05.000Z') }));

    const answered = await rpc('GetTask', { id: TASK_ID });

    expect(answered.json()).toMatchObject({
      result: {
        id: TASK_ID,
        status: { state: 'TASK_STATE_COMPLETED', timestamp: '2026-10-23T10:00:05.000Z' },
        artifacts: [{ artifactId: 'msg_01m3tbfspe96yf1rnr4ank9r01', parts: [{ text: 'Two deals.', mediaType: 'text/plain' }] }],
        history: [{ messageId: 'm-1', role: 'ROLE_USER' }, { messageId: 'msg_01m3tbfspe96yf1rnr4ank9r01', role: 'ROLE_AGENT', parts: [{ text: 'Two deals.' }] }],
      },
    });
  });

  it("answers a question from the ship as input required, the question as the status's message", async () => {
    await sendingTheMessage();
    await calls.addReply({ fleetId: FLEET_ID, messageId: MESSAGE_ID }, aCallReply({ contentType: 'application/vnd.aeolus.question+json', payload: '{"id":"q-1","title":"Which colour?"}', receivedAt: AT }));

    const answered = await rpc('GetTask', { id: TASK_ID });

    expect(answered.json()).toMatchObject({ result: { status: { state: 'TASK_STATE_INPUT_REQUIRED', message: { role: 'ROLE_AGENT', parts: [{ data: { id: 'q-1', title: 'Which colour?' }, mediaType: 'application/vnd.aeolus.question+json' }] } } } });
  });

  it('answers a task whose delivery the fleet gave up as failed', async () => {
    await sendingTheMessage();
    await calls.setDelivery({ fleetId: FLEET_ID, messageId: MESSAGE_ID }, { state: 'undeliverable', since: AT });

    const answered = await rpc('GetTask', { id: TASK_ID });

    expect(answered.json()).toMatchObject({ result: { status: { state: 'TASK_STATE_FAILED' } } });
  });

  it('keeps only the latest entries of the history the client asked for', async () => {
    await sendingTheMessage();
    await calls.addReply({ fleetId: FLEET_ID, messageId: MESSAGE_ID }, aCallReply({ receivedAt: new Date('2026-10-23T10:00:05.000Z') }));

    const answered = await rpc('GetTask', { id: TASK_ID, historyLength: 1 });

    expect(answered.json()).toMatchObject({ result: { history: [{ role: 'ROLE_AGENT' }] } });
    expect(answered.json()).not.toHaveProperty('result.history.1');
  });

  it("answers another client's task as not found", async () => {
    await sendingTheMessage();

    const answered = await rpc('GetTask', { id: TASK_ID }, { authorization: 'Bearer bearer-2', 'a2a-version': '1.0' });

    expect(answered.json()).toMatchObject({ error: { code: -32001 } });
  });
});

describe('ListTasks and CancelTask over JSON-RPC (decision 0060, A8)', () => {
  it("lists only the caller's own tasks", async () => {
    await sendingTheMessage();

    const [own, other] = [await rpc('ListTasks', {}), await rpc('ListTasks', {}, { authorization: 'Bearer bearer-2', 'a2a-version': '1.0' })];

    expect({ own: own.json(), other: other.json() }).toMatchObject({ own: { result: { tasks: [{ id: TASK_ID }] } }, other: { result: {} } });
    expect(other.json()).not.toHaveProperty('result.tasks');
  });

  it('refuses to cancel a task as not cancelable, and an unknown task as not found', async () => {
    await sendingTheMessage();

    const [own, unknown] = [await rpc('CancelTask', { id: TASK_ID }), await rpc('CancelTask', { id: 'task-1' })];

    expect([own.json(), unknown.json()]).toMatchObject([{ error: { code: -32002 } }, { error: { code: -32001 } }]);
  });
});

describe('the same methods over HTTP+JSON (decision 0060)', () => {
  it('sends a message and answers its task', async () => {
    const answered = await rest('POST', '/message:send', { message: A_MESSAGE });

    expect({ status: answered.statusCode, body: answered.json() }).toMatchObject({ status: 200, body: { task: { id: TASK_ID, status: { state: 'TASK_STATE_SUBMITTED' } } } });
  });

  it('reads a task, lists the tasks and refuses to cancel', async () => {
    await rest('POST', '/message:send', { message: A_MESSAGE });

    const [task, list, cancel] = [await rest('GET', `/tasks/${TASK_ID}`), await rest('GET', '/tasks'), await rest('POST', `/tasks/${TASK_ID}:cancel`)];

    expect({ task: task.json(), list: list.json(), cancel: cancel.statusCode }).toMatchObject({ task: { id: TASK_ID }, list: { tasks: [{ id: TASK_ID }] }, cancel: 409 });
  });

  it('answers an unknown task as not found', async () => {
    const answered = await rest('GET', '/tasks/task-1');

    expect(answered.statusCode).toBe(404);
  });

  it('refuses a call with no A2A-Version', async () => {
    const answered = await server.inject({ method: 'POST', url: `/gw/a2a/${CRM_ALIAS}/message:send`, headers: BEARER, payload: { message: A_MESSAGE } });

    expect({ status: answered.statusCode, sent: sender.sent }).toEqual({ status: 400, sent: [] });
  });

  it('states the HTTP+JSON interface on the card beside JSON-RPC', async () => {
    const answered = await server.inject({ method: 'GET', url: `/gw/a2a/${CRM_ALIAS}/.well-known/agent-card.json` });

    expect(answered.json()).toMatchObject({ supportedInterfaces: [{ protocolBinding: 'JSONRPC' }, { url: `${ISSUER}/gw/a2a/${CRM_ALIAS}`, protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' }] });
  });
});
