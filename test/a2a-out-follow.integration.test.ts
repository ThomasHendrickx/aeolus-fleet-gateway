import { createServer, type Server, type ServerResponse } from 'node:http';

import { idSchema, needsAttentionOutputSchema, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { MAY_HAVE_RUN } from '../src/core/mcp-out/hand-call.js';
import { commission, register, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { startFakePagasae } from './support/fake-pagasae.js';
import { aFreePort, startFleetServer } from './support/fleet-server.js';
import { mutate } from './support/gateway-api.js';
import { aConnectedGateway, fleetIdOf, TEST_GATEWAY_SECRET, type Setting } from './support/mcp-client.js';
import { outsidePartiesOn } from './support/outside-parties.js';
import { receiveOne, send } from './support/ship.js';

// A2A out, slice 6 (flow 4.2): a ship of the fleet sends to an outside A2A
// agent's proxy ship; the gateway hands the message to the agent and
// follows its task, each status and artifact a reply. The fleet and the
// gateway are real; the agent is a local server speaking JSON-RPC as A2A
// 1.0 states it, answering as each test scripts it.

/** How long a call to the agent may take in the tests of no answer, so they end soon. */
const SHORT_TIMEOUT_MS = 1_000;
/** How many replies a test reads at most before it counts the rest as never sent. */
const MOST_REPLIES = 6;

type Answer = (method: string, response: ServerResponse) => void;

let setting: Setting;
let app: GatewayApp | undefined;
let agent: Server;
let answer: Answer;
/** Each JSON-RPC call the agent took: its method and params. */
let taken: { method: string; params: unknown }[];
let isStreaming: boolean;
let caller: { shipId: ShipId; crewToken: string };
let proxyShipId: ShipId;

const WORKING = { taskId: 'task-1', contextId: 'ctx-1', status: { state: 'TASK_STATE_WORKING' } };
const COMPLETED = { taskId: 'task-1', contextId: 'ctx-1', status: { state: 'TASK_STATE_COMPLETED' } };
const QUOTE = { taskId: 'task-1', contextId: 'ctx-1', artifact: { artifactId: 'a-1', parts: [{ text: '4 EUR', mediaType: 'text/plain' }] } };
const WORKING_TASK = { id: 'task-1', contextId: 'ctx-1', status: WORKING.status };
const QUOTED_TASK = { id: 'task-1', contextId: 'ctx-1', status: COMPLETED.status, artifacts: [QUOTE.artifact] };

const rpcResult = (response: ServerResponse, result: unknown) => {
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
};

/** A SubscribeToTask stream of these events: ended, or cut once they reached the gateway. */
const stream = (response: ServerResponse, sent: { events: unknown[]; end: 'ended' | 'cut' | 'held' }) => {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of sent.events) {
    response.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: event })}\n\n`);
  }
  if (sent.end === 'cut') {
    setTimeout(() => response.socket?.destroy(), 100);
  } else if (sent.end === 'ended') {
    response.end();
  }
};

beforeEach(async () => {
  taken = [];
  isStreaming = false;
  answer = (method, response) => {
    rpcResult(response, method === 'SendMessage' ? { task: WORKING_TASK } : QUOTED_TASK);
  };
  agent = createServer((request, response) => {
    let text = '';
    request.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
    });
    request.on('end', () => {
      if (request.url === '/.well-known/agent-card.json') {
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(cardAt(`http://${String(request.headers.host)}/a2a`)));
        return;
      }
      const call = z.object({ method: z.string(), params: z.unknown() }).parse(JSON.parse(text));
      taken.push(call);
      answer(call.method, response);
    });
  });
  await new Promise<void>((resolve) => agent.listen(0, '127.0.0.1', resolve));
  const fleet = await startFleetServer(inject('postgresUrl'));
  setting = { fleet, address: '', cookie: await signIn(fleet), databaseUrl: await migratedDatabase(inject('postgresUrl')), pagasae: await startFakePagasae() };
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  agent.closeAllConnections();
  await new Promise((resolve) => agent.close(resolve));
  await setting.pagasae.stop();
  await setting.fleet.stop();
});

function cardAt(url: string) {
  return {
    name: 'Supplier agent',
    description: 'Quotes and books parts.',
    version: '1.0.0',
    supportedInterfaces: [{ url, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
    capabilities: { streaming: isStreaming },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['application/json'],
    skills: [{ id: 'quote', name: 'Quote a price', description: 'Answers a price for a part list.', tags: ['quotes'] }],
  };
}

/** The gateway started, connected, and the supplier's agent added as an approver adds it, marked as told. */
async function started(options: { toolCallTimeoutMs?: number; isRepeatable?: boolean } = {}): Promise<void> {
  const port = await aFreePort();
  setting = { ...setting, address: `http://127.0.0.1:${String(port)}` };
  app = createGatewayApp({ databaseUrl: setting.databaseUrl, fleetUrl: setting.fleet.url, logger: false, publicUrl: setting.address, gatewaySecret: TEST_GATEWAY_SECRET, ...(options.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: options.toolCallTimeoutMs }) });
  await app.server.listen({ host: '127.0.0.1', port });
  await aConnectedGateway(setting);
  const { fleet, cookie } = setting;
  const owner = (await commission(fleet, { cookie, ship: { name: 'person-owner', type: 'person', kind: 'person' } })).shipId;
  const approver = await register(fleet, await commission(fleet, { cookie, ship: { name: 'approver', type: 'agent', scopes: ['fleet:read', 'gateway:approve'] } }));
  const buyer = await commission(fleet, { cookie, ship: { name: 'buyer', type: 'agent', scopes: ['messages:send'] } });
  caller = { shipId: buyer.shipId, crewToken: await register(fleet, buyer) };
  await outsidePartiesOn(setting.databaseUrl, await fleetIdOf(setting));
  const cardUrl = `http://127.0.0.1:${String(z.object({ port: z.number() }).parse(agent.address()).port)}/.well-known/agent-card.json`;
  const added = await mutate(setting.address, { procedure: 'parties.addA2aAgent', crewToken: approver, body: { requestId: crypto.randomUUID(), name: 'supplier', cardUrl, credential: { kind: 'none' }, ownerShipId: owner, scopes: [] } });
  expect(added.status, await added.clone().text()).toBe(200);
  proxyShipId = z.object({ result: z.object({ data: z.object({ proxyShipId: idSchema('ship') }) }) }).parse(await added.json()).result.data.proxyShipId;
  if (options.isRepeatable === false) {
    const marked = await mutate(setting.address, { procedure: 'parties.markA2aAgent', crewToken: approver, body: { name: 'supplier', isRepeatable: false } });
    expect(marked.status, await marked.clone().text()).toBe(200);
  }
}

/** The gateway stopped and started again on the same database, as a restart. */
async function restarted(): Promise<void> {
  await app?.close();
  agent.closeAllConnections();
  const port = await aFreePort();
  setting = { ...setting, address: `http://127.0.0.1:${String(port)}` };
  app = createGatewayApp({ databaseUrl: setting.databaseUrl, fleetUrl: setting.fleet.url, logger: false, publicUrl: setting.address, gatewaySecret: TEST_GATEWAY_SECRET });
  await app.restoreConnections();
  await app.server.listen({ host: '127.0.0.1', port });
}

const askForAQuote = () => send(setting.fleet, { crewToken: caller.crewToken, to: proxyShipId, contentType: 'text/plain', payload: 'Quote 10 bolts' });

/** The replies the buyer gets, until one tells the task completed or none comes. */
async function repliesUntilCompleted() {
  const replies: { inReplyTo: string | null; contentType: string; payload: string }[] = [];
  for (let count = 0; count < MOST_REPLIES; count += 1) {
    const reply = await receiveOne(setting.fleet, caller.crewToken);
    if (reply === undefined) {
      return replies;
    }
    replies.push({ inReplyTo: reply.inReplyTo ?? null, contentType: reply.contentType, payload: reply.payload });
    if (reply.payload.includes('TASK_STATE_COMPLETED')) {
      return replies;
    }
  }
  return replies;
}

/** What each reply tells, read back: a status's state, or the text of an artifact. */
const told = (replies: { contentType: string; payload: string }[]) =>
  replies.map(({ contentType, payload }) => (contentType === 'application/a2a+json' ? z.object({ statusUpdate: z.object({ status: z.object({ state: z.string() }) }) }).parse(JSON.parse(payload)).statusUpdate.status.state : `${contentType}: ${payload}`));

/** Needs attention as argo reads it, once it lists a delivery. */
async function needsAttention() {
  for (let tries = 0; tries < 10; tries += 1) {
    const response = await fetch(`${setting.fleet.url}/trpc/fleet.needsAttention`, { headers: { cookie: setting.cookie } });
    const listed = needsAttentionOutputSchema.parse(z.object({ result: z.object({ data: z.unknown() }) }).parse(await response.json()).result.data);
    if (listed.length > 0) {
      return listed;
    }
    await new Promise((resolve) => setTimeout(resolve, SHORT_TIMEOUT_MS));
  }
  return [];
}

const messageIdsSent = () => taken.filter(({ method }) => method === 'SendMessage').map(({ params }) => z.object({ message: z.object({ messageId: z.string() }) }).parse(params).message.messageId);

describe("a ship of the fleet sends to an outside A2A agent's proxy ship (slice 6)", () => {
  it("hands the message to the agent and replies each change of its task, read by GetTask, until it completed", async () => {
    await started();

    const request = await askForAQuote();
    const replies = await repliesUntilCompleted();

    expect(told(replies)).toEqual(['TASK_STATE_WORKING', 'text/plain: 4 EUR', 'TASK_STATE_COMPLETED']);
    expect(replies.every(({ inReplyTo }) => inReplyTo === request)).toBe(true);
    expect(taken.map(({ method }) => method)).toEqual(['SendMessage', 'GetTask']);
  });

  it('subscribes again when the stream breaks, and replies each change once', async () => {
    isStreaming = true;
    let subscriptions = 0;
    answer = (method, response) => {
      if (method === 'SendMessage') {
        rpcResult(response, { task: WORKING_TASK });
        return;
      }
      subscriptions += 1;
      // The second stream starts again from the task as it stands, as an agent's SubscribeToTask does.
      stream(response, subscriptions === 1 ? { events: [{ statusUpdate: WORKING }, { artifactUpdate: QUOTE }], end: 'cut' } : { events: [{ statusUpdate: WORKING }, { artifactUpdate: QUOTE }, { statusUpdate: COMPLETED }], end: 'ended' });
    };
    await started();

    await askForAQuote();
    const replies = await repliesUntilCompleted();

    expect(told(replies)).toEqual(['TASK_STATE_WORKING', 'text/plain: 4 EUR', 'TASK_STATE_COMPLETED']);
    expect(taken.map(({ method }) => method)).toEqual(['SendMessage', 'SubscribeToTask', 'SubscribeToTask']);
  });

  it('follows the task again after a restart, and replies no change twice', async () => {
    isStreaming = true;
    let subscriptions = 0;
    answer = (method, response) => {
      if (method === 'SendMessage') {
        rpcResult(response, { task: WORKING_TASK });
        return;
      }
      subscriptions += 1;
      stream(response, subscriptions === 1 ? { events: [{ statusUpdate: WORKING }, { artifactUpdate: QUOTE }], end: 'held' } : { events: [{ statusUpdate: WORKING }, { artifactUpdate: QUOTE }, { statusUpdate: COMPLETED }], end: 'ended' });
    };
    await started();
    await askForAQuote();
    const beforeRestart = [await receiveOne(setting.fleet, caller.crewToken), await receiveOne(setting.fleet, caller.crewToken)];

    await restarted();
    const afterRestart = await repliesUntilCompleted();

    expect(told([...beforeRestart.flatMap((reply) => (reply === undefined ? [] : [reply])), ...afterRestart])).toEqual(['TASK_STATE_WORKING', 'text/plain: 4 EUR', 'TASK_STATE_COMPLETED']);
    expect(taken.map(({ method }) => method)).toEqual(['SendMessage', 'SubscribeToTask', 'SubscribeToTask']);
  });

  const noAnswers: [string, Answer][] = [
    ['an HTTP 503', (_method, response) => response.writeHead(503).end('down')],
    ['no answer within the timeout', () => undefined],
    ['a connection broken mid answer', (_method, response) => response.socket?.destroy()],
  ];

  it.each(noAnswers)('reports a message to an agent marked not repeatable that got %s as not handled, sent once (A9)', async (_kind, noAnswer) => {
    answer = noAnswer;
    await started({ toolCallTimeoutMs: SHORT_TIMEOUT_MS, isRepeatable: false });

    await askForAQuote();
    const listed = await needsAttention();

    expect(listed.map(({ state, reason, ship }) => ({ state, reason, shipId: ship.id }))).toEqual([{ state: 'notHandled', reason: MAY_HAVE_RUN, shipId: proxyShipId }]);
    expect(messageIdsSent()).toHaveLength(1);
  });

  it.each(noAnswers)('hands a message that got %s again to a repeatable agent, as the same message', async (_kind, noAnswer) => {
    answer = (method, response) => {
      if (messageIdsSent().length === 1) {
        noAnswer(method, response);
        return;
      }
      rpcResult(response, { task: QUOTED_TASK });
    };
    await started({ toolCallTimeoutMs: SHORT_TIMEOUT_MS });

    await askForAQuote();
    const replies = await repliesUntilCompleted();

    expect(told(replies)).toEqual(['text/plain: 4 EUR', 'TASK_STATE_COMPLETED']);
    const [first, second] = messageIdsSent();
    expect({ count: messageIdsSent().length, isSame: first === second }).toEqual({ count: 2, isSame: true });
  });
});
