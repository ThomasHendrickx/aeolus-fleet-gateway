import { PAYLOAD_MAX_BYTES } from '@aeolus-fleet/common';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { fakeConfigIds, fakeResolver, memoryPushStore } from '../../../test/support/a2a-push-fakes.js';
import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { CRM_SHIP_ID, MESSAGE_ID, aCallReply, aDiscoveredShip, fakeCallKeys, fakeCallSender, fakeDiscovery, memoryClientCalls } from '../../../test/support/mcp-in-fakes.js';
import { ISSUER, fakeSecrets } from '../../../test/support/oauth-fakes.js';
import { PROXY_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import { createAuthenticateA2aClient } from '../../core/a2a-in/authenticate-a2a-client.js';
import { createFindReachedShip } from '../../core/a2a-in/find-reached-ship.js';
import { createFollowA2aTask } from '../../core/a2a-in/follow-a2a-task.js';
import { createListPushConfigs } from '../../core/a2a-in/list-push-configs.js';
import { createReadPushConfig } from '../../core/a2a-in/read-push-config.js';
import { createRemovePushConfig } from '../../core/a2a-in/remove-push-config.js';
import { createSetPushConfig } from '../../core/a2a-in/set-push-config.js';
import { createListA2aTasks } from '../../core/a2a-in/list-a2a-tasks.js';
import { createListReachedShips } from '../../core/a2a-in/list-reached-ships.js';
import { createReadA2aTask } from '../../core/a2a-in/read-a2a-task.js';
import { createSendA2aMessage } from '../../core/a2a-in/send-a2a-message.js';
import { createSubscribeToA2aTask } from '../../core/a2a-in/subscribe-to-a2a-task.js';
import type { Sleep } from '../../core/mcp-out/run-party.js';
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
let pushStore: ReturnType<typeof memoryPushStore>;
let now: Date;
/** What happens in the fleet while a stream follows its task, one step per poll; a poll with no step left fails the stream. */
let steps: (() => Promise<void>)[];
const sleep: Sleep = async (ms) => {
  const step = steps.shift();
  if (step === undefined) {
    throw new Error('The stream polled past the steps the test gave');
  }
  now = new Date(now.getTime() + ms);
  await step();
};

beforeEach(async () => {
  isOn = true;
  const parties = memoryPartyStore();
  await parties.save({ fleetId: FLEET_ID, name: 'supplier', kind: 'a2aClient', bearerHash: 'hash(bearer-1)', state: 'crewed', proxyShipId: PROXY_SHIP_ID, secret: null, crewToken: 'aeolus_ct_v1_proxy', requestId: 'r-1', requestHash: 'h', approvedAt: AT });
  await parties.save({ fleetId: FLEET_ID, name: 'other', kind: 'a2aClient', bearerHash: 'hash(bearer-2)', state: 'crewed', proxyShipId: PROXY_SHIP_ID, secret: null, crewToken: 'aeolus_ct_v1_other', requestId: 'r-2', requestHash: 'h', approvedAt: AT });
  discovery = fakeDiscovery();
  sender = fakeCallSender();
  calls = memoryClientCalls();
  now = AT;
  steps = [];
  const clock = { now: () => now };
  const followTask = createFollowA2aTask({ calls, clock, sleep, pollMs: 250 });
  pushStore = memoryPushStore();
  const resolver = fakeResolver({ 'hooks.supplier.example': ['93.184.215.14'], 'inside.supplier.example': ['10.0.0.5'] });
  const findReachedShip = createFindReachedShip({ listReachedShips: createListReachedShips({ parties, discovery, aliases }) });
  server = Fastify();
  registerA2aEndpoint(server, {
    issuer: ISSUER,
    authenticate: createAuthenticateA2aClient({ parties, secrets: fakeSecrets(), servesOutsideParties: () => Promise.resolve(isOn) }),
    findReachedShip,
    sendMessage: createSendA2aMessage({ parties, findReachedShip, sender, calls, keys: fakeCallKeys(), clock, sleep: () => Promise.resolve(), waitMaxMs: 30_000, waitPollMs: 250 }),
    readTask: createReadA2aTask({ calls, clock }),
    listTasks: createListA2aTasks({ calls, clock }),
    followTask,
    subscribeToTask: createSubscribeToA2aTask({ calls, clock, follow: followTask }),
    setPushConfig: createSetPushConfig({ calls, configs: pushStore, resolver, ids: fakeConfigIds(), clock }),
    readPushConfig: createReadPushConfig({ calls, configs: pushStore }),
    listPushConfigs: createListPushConfigs({ calls, configs: pushStore }),
    removePushConfig: createRemovePushConfig({ calls, configs: pushStore }),
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
      supportedInterfaces: [{ url: `${ISSUER}/gw/a2a/${CRM_ALIAS}`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }, { protocolBinding: 'HTTP+JSON' }],
      provider: { organization: 'Aeolus gateway', url: ISSUER },
      capabilities: { streaming: true, pushNotifications: true, extendedAgentCard: true },
      securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: 'Bearer' } } },
      securityRequirements: [{ schemes: { bearer: {} } }],
    });
    expect(answered.json()).not.toHaveProperty('skills');
    expect(JSON.stringify(answered.json())).not.toContain('The CRM');
  });

  it('is served the same for an alias of no ship, so it tells nothing', async () => {
    const [crm, none] = await Promise.all([CRM_ALIAS, NO_SHIP_ALIAS].map((alias) => server.inject({ method: 'GET', url: `/gw/a2a/${alias}/.well-known/agent-card.json` })));

    const interfaceOf = (protocolBinding: string) => ({ url: `${ISSUER}/gw/a2a/${NO_SHIP_ALIAS}`, protocolBinding, protocolVersion: '1.0' });
    expect(none?.json()).toEqual({ ...crm?.json(), name: NO_SHIP_ALIAS, supportedInterfaces: [interfaceOf('JSONRPC'), interfaceOf('HTTP+JSON')] });
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


});

const TASK_ID = `handle(${FLEET_ID}:${MESSAGE_ID})`;
const A_MESSAGE = { messageId: 'm-1', role: 'ROLE_USER', parts: [{ text: 'Quote 40 chairs.' }] };

/** A JSON-RPC call to the alias's interface, as the bearer's client, at A2A 1.0 unless the headers say otherwise. */
const rpcAs = (headers: Record<string, string>) => (method: string, params: Record<string, unknown>) =>
  server.inject({ method: 'POST', url: `/gw/a2a/${CRM_ALIAS}`, headers, payload: { jsonrpc: '2.0', id: 7, method, params } });
const rpc = rpcAs({ ...BEARER, 'a2a-version': '1.0' });

/** An HTTP+JSON call to the alias's interface, as the bearer's client, at A2A 1.0. */
const rest = (method: 'GET' | 'POST', { path, payload }: { path: string; payload?: Record<string, unknown> }) =>
  server.inject({ method, url: `/gw/a2a/${CRM_ALIAS}${path}`, headers: { ...BEARER, 'a2a-version': '1.0' }, ...(payload === undefined ? {} : { payload }) });

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

  it("refuses a payload over the fleet's limit as invalid params, sending nothing", async () => {
    const answered = await rpc('SendMessage', { message: { ...A_MESSAGE, parts: [{ text: 'x'.repeat(PAYLOAD_MAX_BYTES + 1) }] } });

    expect(answered.json()).toMatchObject({ id: 7, error: { code: -32602 } });
    expect(sender.sent).toEqual([]);
  });

  it('refuses a body of a content type other than JSON as not supported, sending nothing', async () => {
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'SendMessage', params: { message: A_MESSAGE } });
    const answered = await server.inject({ method: 'POST', url: `/gw/a2a/${CRM_ALIAS}`, headers: { ...BEARER, 'a2a-version': '1.0', 'content-type': 'text/plain' }, payload });

    expect(answered.json()).toMatchObject({ error: { code: -32005 } });
    expect(sender.sent).toEqual([]);
  });

  it('refuses a call with no A2A-Version, or one it does not speak, sending nothing', async () => {
    const [missing, unsupported] = [await rpcAs(BEARER)('SendMessage', { message: A_MESSAGE }), await rpcAs({ ...BEARER, 'a2a-version': '0.3' })('SendMessage', { message: A_MESSAGE })];

    expect([missing.json<unknown>(), unsupported.json<unknown>()]).toMatchObject([{ error: { code: -32009 } }, { error: { code: -32009 } }]);
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

    const answered = await rpcAs({ authorization: 'Bearer bearer-2', 'a2a-version': '1.0' })('GetTask', { id: TASK_ID });

    expect(answered.json()).toMatchObject({ error: { code: -32001 } });
  });
});

describe('ListTasks and CancelTask over JSON-RPC (decision 0060, A8)', () => {
  it("lists only the caller's own tasks", async () => {
    await sendingTheMessage();

    const [own, other] = [await rpc('ListTasks', {}), await rpcAs({ authorization: 'Bearer bearer-2', 'a2a-version': '1.0' })('ListTasks', {})];

    expect({ own: own.json<unknown>(), other: other.json<unknown>() }).toMatchObject({ own: { result: { tasks: [{ id: TASK_ID }] } }, other: { result: { tasks: [] } } });
  });

  it('refuses to cancel a task as not cancelable, and an unknown task as not found', async () => {
    await sendingTheMessage();

    const [own, unknown] = [await rpc('CancelTask', { id: TASK_ID }), await rpc('CancelTask', { id: 'task-1' })];

    expect([own.json<unknown>(), unknown.json<unknown>()]).toMatchObject([{ error: { code: -32002 } }, { error: { code: -32001 } }]);
  });
});

describe('the same methods over HTTP+JSON (decision 0060)', () => {
  it('sends a message and answers its task', async () => {
    const answered = await rest('POST', { path: '/message:send', payload: { message: A_MESSAGE } });

    expect({ status: answered.statusCode, body: answered.json<unknown>() }).toMatchObject({ status: 200, body: { task: { id: TASK_ID, status: { state: 'TASK_STATE_SUBMITTED' } } } });
  });

  it('reads a task, lists the tasks and refuses to cancel', async () => {
    await rest('POST', { path: '/message:send', payload: { message: A_MESSAGE } });

    const [task, list, cancel] = [await rest('GET', { path: `/tasks/${TASK_ID}` }), await rest('GET', { path: '/tasks' }), await rest('POST', { path: `/tasks/${TASK_ID}:cancel` })];

    expect({ task: task.json<unknown>(), list: list.json<unknown>(), cancel: cancel.statusCode }).toMatchObject({ task: { id: TASK_ID }, list: { tasks: [{ id: TASK_ID }] }, cancel: 409 });
  });

  it('refuses to cancel an unknown task as not found, posted with a JSON content type and no body', async () => {
    const answered = await server.inject({ method: 'POST', url: `/gw/a2a/${CRM_ALIAS}/tasks/task-1:cancel`, headers: { ...BEARER, 'a2a-version': '1.0', 'content-type': 'application/json' } });

    expect(answered.statusCode).toBe(404);
  });

  it('answers its tasks and its errors as application/json', async () => {
    const [sent, unknown] = [await rest('POST', { path: '/message:send', payload: { message: A_MESSAGE } }), await rest('GET', { path: '/tasks/task-1' })];

    expect([sent.headers['content-type'], unknown.headers['content-type']]).toEqual(['application/json; charset=utf-8', 'application/json; charset=utf-8']);
  });

  it('answers an unknown task as not found', async () => {
    const answered = await rest('GET', { path: '/tasks/task-1' });

    expect(answered.statusCode).toBe(404);
  });

  it('refuses a body of a content type other than JSON with 415, sending nothing', async () => {
    const payload = JSON.stringify({ message: A_MESSAGE });
    const answered = await server.inject({ method: 'POST', url: `/gw/a2a/${CRM_ALIAS}/message:send`, headers: { ...BEARER, 'a2a-version': '1.0', 'content-type': 'text/plain' }, payload });

    expect({ status: answered.statusCode, sent: sender.sent }).toEqual({ status: 415, sent: [] });
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

/** The events of a server-sent event stream, each event's data as JSON. */
function eventsOf(body: string): unknown[] {
  return body
    .split('\n\n')
    .filter((event) => event.startsWith('data: '))
    .map((event): unknown => JSON.parse(event.slice('data: '.length)));
}

/** The ship's answer to the message, kept as the worker keeps it. */
const theAnswer = () => calls.addReply({ fleetId: FLEET_ID, messageId: MESSAGE_ID }, aCallReply({ receivedAt: now }));
/** A question from the ship, kept as the worker keeps it. */
const aQuestion = () => calls.addReply({ fleetId: FLEET_ID, messageId: MESSAGE_ID }, aCallReply({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9q01', messageId: 'msg_01m3tbfspe96yf1rnr4ank9q01', contentType: 'application/vnd.aeolus.question+json', payload: '{"title":"Which colour?"}', receivedAt: now }));

const STREAMED_TO_COMPLETION = [
  { task: { id: TASK_ID, status: { state: 'TASK_STATE_SUBMITTED' } } },
  { artifactUpdate: { taskId: TASK_ID, artifact: { parts: [{ text: 'Two deals.' }] }, lastChunk: true } },
  { statusUpdate: { taskId: TASK_ID, status: { state: 'TASK_STATE_COMPLETED' } } },
];

describe('SendStreamingMessage and SubscribeToTask over JSON-RPC (slice 3)', () => {
  it('streams the task first, then its changes, and closes once it completes', async () => {
    steps = [theAnswer];

    const answered = await rpc('SendStreamingMessage', { message: A_MESSAGE });

    expect(answered.headers['content-type']).toBe('text/event-stream');
    expect(eventsOf(answered.body).map((event) => z.object({ result: z.unknown() }).parse(event).result)).toMatchObject(STREAMED_TO_COMPLETION);
  });

  it('sends the message once, after the fleet answered OK', async () => {
    steps = [theAnswer];

    await rpc('SendStreamingMessage', { message: A_MESSAGE });

    expect(sender.sent).toHaveLength(1);
  });

  it('streams a task subscribed to from the task as it stands, so a dropped stream loses nothing', async () => {
    await sendingTheMessage();
    await aQuestion();
    steps = [theAnswer];

    const answered = await rpc('SubscribeToTask', { id: TASK_ID });

    expect(eventsOf(answered.body).map((event) => z.object({ result: z.unknown() }).parse(event).result)).toMatchObject([
      { task: { id: TASK_ID, status: { state: 'TASK_STATE_INPUT_REQUIRED' } } },
      { artifactUpdate: { taskId: TASK_ID } },
      { statusUpdate: { status: { state: 'TASK_STATE_COMPLETED' } } },
    ]);
  });

  it('refuses to subscribe to an ended task as an unsupported operation, and to an unknown one as not found', async () => {
    await sendingTheMessage();
    await theAnswer();

    const [ended, unknown] = [await rpc('SubscribeToTask', { id: TASK_ID }), await rpc('SubscribeToTask', { id: 'task-1' })];

    expect([ended.headers['content-type'], unknown.headers['content-type']]).toEqual(['application/json; charset=utf-8', 'application/json; charset=utf-8']);
    expect([ended.json<unknown>(), unknown.json<unknown>()]).toMatchObject([{ error: { code: -32004 } }, { error: { code: -32001 } }]);
  });
});

describe('message:stream and tasks/{id}:subscribe over HTTP+JSON (slice 3)', () => {
  it('streams the task first, then its changes, and closes once it completes', async () => {
    steps = [theAnswer];

    const answered = await rest('POST', { path: '/message:stream', payload: { message: A_MESSAGE } });

    expect(answered.headers['content-type']).toBe('text/event-stream');
    expect(eventsOf(answered.body)).toMatchObject(STREAMED_TO_COMPLETION);
  });

  it.each(['GET', 'POST'] as const)('subscribes to a task on %s, the task as it stands first', async (method) => {
    await sendingTheMessage();
    await aQuestion();
    steps = [theAnswer];

    const answered = await rest(method, { path: `/tasks/${TASK_ID}:subscribe` });

    expect(eventsOf(answered.body)).toMatchObject([{ task: { status: { state: 'TASK_STATE_INPUT_REQUIRED' } } }, { artifactUpdate: { taskId: TASK_ID } }, { statusUpdate: { status: { state: 'TASK_STATE_COMPLETED' } } }]);
  });

  it('refuses to subscribe to an ended task with 400, and to an unknown one with 404', async () => {
    await sendingTheMessage();
    await theAnswer();

    const [ended, unknown] = [await rest('POST', { path: `/tasks/${TASK_ID}:subscribe` }), await rest('GET', { path: '/tasks/task-1:subscribe' })];

    expect([ended.statusCode, unknown.statusCode]).toEqual([400, 404]);
  });
});

const WEBHOOK = 'https://hooks.supplier.example/a2a';
const A_PUSH_CONFIG = { taskId: TASK_ID, id: 'hook-1', url: WEBHOOK, token: 'tok-1', authentication: { scheme: 'Bearer', credentials: 'secret-1' } };

describe('the push config methods over JSON-RPC (slice 4)', () => {
  it("keeps a push config on the caller's own task, and answers it without its token or authentication", async () => {
    await sendingTheMessage();

    const answered = await rpc('CreateTaskPushNotificationConfig', A_PUSH_CONFIG);

    expect(answered.json()).toEqual({ jsonrpc: '2.0', id: 7, result: { taskId: TASK_ID, id: 'hook-1', url: WEBHOOK } });
    expect(pushStore.configs).toMatchObject([{ token: 'tok-1', authentication: { scheme: 'Bearer', credentials: 'secret-1' } }]);
  });

  it('refuses a webhook that is not https, or resolves inside, as invalid params, keeping nothing', async () => {
    await sendingTheMessage();

    const [plain, inside] = [await rpc('CreateTaskPushNotificationConfig', { ...A_PUSH_CONFIG, url: 'http://hooks.supplier.example/a2a' }), await rpc('CreateTaskPushNotificationConfig', { ...A_PUSH_CONFIG, url: 'https://inside.supplier.example/a2a' })];

    expect([plain.json<unknown>(), inside.json<unknown>()]).toMatchObject([{ error: { code: -32602 } }, { error: { code: -32602 } }]);
    expect(pushStore.configs).toEqual([]);
  });

  it('refuses a config on a task of no call of this client as not found', async () => {
    await expect(rpc('CreateTaskPushNotificationConfig', A_PUSH_CONFIG).then((answered) => answered.json<unknown>())).resolves.toMatchObject({ error: { code: -32001 } });
  });

  it('reads, lists and deletes it', async () => {
    await sendingTheMessage();
    await rpc('CreateTaskPushNotificationConfig', A_PUSH_CONFIG);

    const read = await rpc('GetTaskPushNotificationConfig', { taskId: TASK_ID, id: 'hook-1' });
    const listed = await rpc('ListTaskPushNotificationConfigs', { taskId: TASK_ID });
    const deleted = await rpc('DeleteTaskPushNotificationConfig', { taskId: TASK_ID, id: 'hook-1' });
    const readAgain = await rpc('GetTaskPushNotificationConfig', { taskId: TASK_ID, id: 'hook-1' });

    expect([read.json<unknown>(), listed.json<unknown>(), deleted.json<unknown>(), readAgain.json<unknown>()]).toMatchObject([
      { result: { taskId: TASK_ID, id: 'hook-1', url: WEBHOOK } },
      { result: { configs: [{ id: 'hook-1', url: WEBHOOK }] } },
      { result: {} },
      { error: { code: -32001 } },
    ]);
    expect(JSON.stringify(listed.json())).not.toContain('secret-1');
  });
});

describe('the push config methods over HTTP+JSON (slice 4)', () => {
  it('keeps, reads, lists and deletes a push config on its own task', async () => {
    await sendingTheMessage();

    const created = await rest('POST', { path: `/tasks/${TASK_ID}/pushNotificationConfigs`, payload: A_PUSH_CONFIG });
    const read = await rest('GET', { path: `/tasks/${TASK_ID}/pushNotificationConfigs/hook-1` });
    const listed = await rest('GET', { path: `/tasks/${TASK_ID}/pushNotificationConfigs` });
    const deleted = await server.inject({ method: 'DELETE', url: `/gw/a2a/${CRM_ALIAS}/tasks/${TASK_ID}/pushNotificationConfigs/hook-1`, headers: { ...BEARER, 'a2a-version': '1.0' } });

    expect([created.statusCode, read.statusCode, listed.statusCode, deleted.statusCode]).toEqual([200, 200, 200, 200]);
    expect([created.json<unknown>(), read.json<unknown>(), listed.json<unknown>()]).toMatchObject([{ id: 'hook-1', url: WEBHOOK }, { id: 'hook-1' }, { configs: [{ id: 'hook-1' }] }]);
    expect(pushStore.configs).toEqual([]);
  });

  it('deletes a config again without error, whatever content type an empty body names', async () => {
    await sendingTheMessage();
    await rest('POST', { path: `/tasks/${TASK_ID}/pushNotificationConfigs`, payload: A_PUSH_CONFIG });
    const deleting = () => server.inject({ method: 'DELETE', url: `/gw/a2a/${CRM_ALIAS}/tasks/${TASK_ID}/pushNotificationConfigs/hook-1`, headers: { ...BEARER, 'a2a-version': '1.0', 'content-type': 'text/plain;charset=UTF-8' } });

    const [first, again] = [await deleting(), await deleting()];

    expect([first.statusCode, again.statusCode]).toEqual([200, 200]);
  });

  it('refuses a webhook that resolves inside with 400, and a task of no call of this client with 404', async () => {
    await sendingTheMessage();

    const [inside, unknown] = [await rest('POST', { path: `/tasks/${TASK_ID}/pushNotificationConfigs`, payload: { ...A_PUSH_CONFIG, url: 'https://10.0.0.5/a2a' } }), await rest('GET', { path: '/tasks/task-1/pushNotificationConfigs' })];

    expect([inside.statusCode, unknown.statusCode]).toEqual([400, 404]);
  });
});
