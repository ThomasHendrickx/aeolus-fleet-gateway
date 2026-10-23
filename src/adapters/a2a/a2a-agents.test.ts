import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { AgentConnection } from '../../core/a2a-out/ports.js';
import { createA2aAgents, gatewayStatuses } from './a2a-agents.js';

// The gateway calls an outside A2A agent through @a2a-js/sdk's client
// (A11). Here the agent is a local server speaking JSON-RPC and HTTP+JSON
// as A2A 1.0 states them; each failure reads as where it happened, so the
// core decides whether it may hand the message again (slice 6, pick 6).

type Handler = (request: { path: string; method: string; headers: IncomingHttpHeaders; body: unknown }, response: ServerResponse) => void;

let server: Server;
let base: string;
let handle: Handler;
let received: { path: string; method: string; headers: IncomingHttpHeaders; body: unknown }[];

/** A JSON-RPC answer: its result, or its error. */
const rpcAnswer = (response: ServerResponse, answer: { id: unknown; result: unknown } | { id: unknown; error: { code: number; message: string } }) => {
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', ...answer }));
};
const idOf = (body: unknown) => z.object({ id: z.unknown() }).parse(body).id;

const WORKING_TASK = { id: 'task-1', contextId: 'ctx-1', status: { state: 'TASK_STATE_WORKING' } };
const QUOTED_TASK = { id: 'task-1', contextId: 'ctx-1', status: { state: 'TASK_STATE_COMPLETED' }, artifacts: [{ artifactId: 'a-1', parts: [{ text: '4 EUR', mediaType: 'text/plain' }] }] };

beforeEach(async () => {
  received = [];
  handle = (request, response) => {
    rpcAnswer(response, { id: idOf(request.body), result: { task: WORKING_TASK } });
  };
  server = createServer((request: IncomingMessage, response) => {
    let text = '';
    request.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
    });
    request.on('end', () => {
      const isJson = request.headers['content-type']?.includes('json') === true;
      const entry = { path: request.url ?? '', method: request.method ?? '', headers: request.headers, body: text === '' ? undefined : isJson ? z.unknown().parse(JSON.parse(text)) : text };
      received.push(entry);
      handle(entry, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${String(z.object({ port: z.number() }).parse(server.address()).port)}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const rpc = (credential: AgentConnection['credential'] = { kind: 'bearer', token: 'tok-1' }, isStreaming = false): AgentConnection => ({ endpoint: { url: `${base}/a2a`, protocolBinding: 'JSONRPC', isStreaming }, credential });
const QUOTE = { messageId: 'out-1', taskId: null, contextId: null, content: { kind: 'parts' as const, parts: [{ kind: 'text' as const, text: 'Quote 10 bolts', mediaType: 'text/plain' }] } };
const agents = createA2aAgents({ timeoutMs: 1_000 });

describe('SendMessage to an outside A2A agent (slice 6)', () => {
  it('sends the message over JSON-RPC with the bearer and A2A-Version 1.0, returning at once, and reads the task it took', async () => {
    const sent = await agents.send(rpc(), QUOTE);

    expect(sent).toEqual({ kind: 'task', taskId: 'task-1', contextId: 'ctx-1', events: [{ kind: 'status', state: 'working', json: JSON.stringify({ statusUpdate: { taskId: 'task-1', contextId: 'ctx-1', status: { state: 'TASK_STATE_WORKING' } } }) }] });
    expect(received[0]).toMatchObject({ path: '/a2a', headers: { authorization: 'Bearer tok-1', 'a2a-version': '1.0' }, body: { method: 'SendMessage', params: { message: { messageId: 'out-1', role: 'ROLE_USER', parts: [{ text: 'Quote 10 bolts', mediaType: 'text/plain' }] }, configuration: { returnImmediately: true } } } });
  });

  it('reads each artifact of the task as an event before its status', async () => {
    handle = (request, response) => {
      rpcAnswer(response, { id: idOf(request.body), result: { task: QUOTED_TASK } });
    };

    const sent = await agents.send(rpc(), QUOTE);

    expect(sent).toMatchObject({ kind: 'task', events: [{ kind: 'artifact', parts: [{ kind: 'text', text: '4 EUR', mediaType: 'text/plain' }] }, { kind: 'status', state: 'completed' }] });
  });

  it('reads a message answer with no task', async () => {
    handle = (request, response) => {
      rpcAnswer(response, { id: idOf(request.body), result: { message: { messageId: 'm-1', role: 'ROLE_AGENT', parts: [{ data: { price: 4 } }] } } });
    };

    await expect(agents.send(rpc(), QUOTE)).resolves.toMatchObject({ kind: 'message', event: { kind: 'message', parts: [{ kind: 'data', data: { price: 4 } }] } });
  });

  it("sends a data part as data, and a sender's whole A2A message with its own parts", async () => {
    await agents.send(rpc(), { ...QUOTE, content: { kind: 'parts', parts: [{ kind: 'data', data: { bolts: 10 }, mediaType: 'application/json' }] } });
    await agents.send(rpc(), { messageId: 'out-2', taskId: 'task-1', contextId: 'ctx-1', content: { kind: 'whole', message: { messageId: 'mine', role: 'ROLE_USER', parts: [{ url: 'https://files.example/a.pdf', mediaType: 'application/pdf' }] } } });

    expect(received.map((request) => z.object({ params: z.object({ message: z.unknown() }) }).parse(request.body).params.message)).toEqual([
      { messageId: 'out-1', role: 'ROLE_USER', parts: [{ data: { bolts: 10 }, mediaType: 'application/json' }] },
      { messageId: 'out-2', taskId: 'task-1', contextId: 'ctx-1', role: 'ROLE_USER', parts: [{ url: 'https://files.example/a.pdf', mediaType: 'application/pdf' }] },
    ]);
  });

  it('sends over HTTP+JSON when that is the interface', async () => {
    handle = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ task: WORKING_TASK }));
    };

    await expect(agents.send({ endpoint: { url: base, protocolBinding: 'HTTP+JSON', isStreaming: false }, credential: { kind: 'none' } }, QUOTE)).resolves.toMatchObject({ kind: 'task', taskId: 'task-1' });
    expect(received[0]).toMatchObject({ path: '/message:send', method: 'POST' });
    expect(received[0]?.headers).not.toHaveProperty('authorization');
  });

  it('reads an A2A error answer as a refusal, with its message', async () => {
    handle = (request, response) => {
      rpcAnswer(response, { id: idOf(request.body), error: { code: -32602, message: 'No part list given' } });
    };

    const sent = await agents.send(rpc(), QUOTE);

    expect(sent).toMatchObject({ kind: 'refused' });
    expect(sent.kind === 'refused' ? sent.reason : '').toContain('No part list given');
  });

  it.each([401, 403, 404])('reads an HTTP %i as a refusal', async (status) => {
    handle = (_request, response) => {
      response.writeHead(status).end('no');
    };

    await expect(agents.send(rpc(), QUOTE)).resolves.toMatchObject({ kind: 'refused' });
  });

  it.each([500, 503])('reads an HTTP %i as no answer: it may have run', async (status) => {
    handle = (_request, response) => {
      response.writeHead(status).end('down');
    };

    await expect(agents.send(rpc(), QUOTE)).resolves.toMatchObject({ kind: 'unanswered' });
  });

  it('reads no answer within the timeout as no answer', async () => {
    handle = () => undefined;

    await expect(createA2aAgents({ timeoutMs: 200 }).send(rpc(), QUOTE)).resolves.toMatchObject({ kind: 'unanswered' });
  });

  it('reads a connection broken mid answer as no answer', async () => {
    handle = (_request, response) => {
      response.socket?.destroy();
    };

    await expect(agents.send(rpc(), QUOTE)).resolves.toMatchObject({ kind: 'unanswered' });
  });

  it('reads an agent no connection reaches as not sent: nothing ran', async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));

    await expect(agents.send(rpc(), QUOTE)).resolves.toMatchObject({ kind: 'notSent' });
    server = createServer();
  });

  it("takes a token for client credentials from the issuer's token endpoint, and sends it", async () => {
    handle = (request, response) => {
      if (request.path === '/.well-known/oauth-authorization-server') {
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ issuer: base, token_endpoint: `${base}/token` }));
      } else if (request.path === '/token') {
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'at-1', token_type: 'Bearer', expires_in: 3600 }));
      } else {
        rpcAnswer(response, { id: idOf(request.body), result: { task: WORKING_TASK } });
      }
    };

    await agents.send(rpc({ kind: 'clientCredentials', clientId: 'gw', clientSecret: 's-1', issuer: base }), QUOTE);

    expect(received.find((request) => request.path === '/a2a')?.headers.authorization).toBe('Bearer at-1');
    expect(received.find((request) => request.path === '/token')?.headers.authorization).toBe(`Basic ${Buffer.from('gw:s-1').toString('base64')}`);
  });

  it('reads an issuer that gives no token as not sent', async () => {
    handle = (_request, response) => {
      response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid_client' }));
    };

    await expect(agents.send(rpc({ kind: 'clientCredentials', clientId: 'gw', clientSecret: 's-1', issuer: base }), QUOTE)).resolves.toMatchObject({ kind: 'notSent' });
    expect(received.some((request) => request.path === '/a2a')).toBe(false);
  });
});

describe('GetTask of an outside A2A agent (slice 6)', () => {
  it('reads the task as it stands: each artifact, then its status', async () => {
    handle = (request, response) => {
      rpcAnswer(response, { id: idOf(request.body), result: QUOTED_TASK });
    };

    await expect(agents.getTask(rpc(), 'task-1')).resolves.toMatchObject({ kind: 'read', events: [{ kind: 'artifact' }, { kind: 'status', state: 'completed' }] });
    expect(received[0]?.body).toMatchObject({ method: 'GetTask', params: { id: 'task-1' } });
  });

  it('reads a task the agent knows no more as gone', async () => {
    handle = (request, response) => {
      rpcAnswer(response, { id: idOf(request.body), error: { code: -32001, message: 'Task not found' } });
    };

    await expect(agents.getTask(rpc(), 'task-1')).resolves.toMatchObject({ kind: 'gone' });
  });

  it('reads a 503 as no answer', async () => {
    handle = (_request, response) => {
      response.writeHead(503).end();
    };

    await expect(agents.getTask(rpc(), 'task-1')).resolves.toMatchObject({ kind: 'unanswered' });
  });
});

describe('SubscribeToTask of an outside A2A agent (slice 6)', () => {
  const sse = (response: ServerResponse, stream: { id: unknown; results: unknown[]; isCut?: boolean }) => {
    const { id, results, isCut = false } = stream;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const result of results) {
      response.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`);
    }
    if (isCut) {
      // Once what was written reached the gateway, the connection breaks with no end of stream.
      setTimeout(() => response.socket?.destroy(), 100);
    } else {
      response.end();
    }
  };

  it('hands each event the stream sends in turn, and ends closed when the agent closes it', async () => {
    handle = (request, response) => {
      sse(response, { id: idOf(request.body), results: [{ statusUpdate: { taskId: 'task-1', contextId: 'ctx-1', status: { state: 'TASK_STATE_WORKING' } } }, { artifactUpdate: { taskId: 'task-1', contextId: 'ctx-1', artifact: { artifactId: 'a-1', parts: [{ text: '4 EUR' }] } } }, { statusUpdate: { taskId: 'task-1', contextId: 'ctx-1', status: { state: 'TASK_STATE_COMPLETED' } } }] });
    };
    const events: unknown[] = [];

    const end = await agents.subscribe(rpc(undefined, true), { taskId: 'task-1', timeoutMs: 1_000, signal: new AbortController().signal, onEvent: (event) => Promise.resolve(void events.push(event)) });

    expect(end).toEqual({ kind: 'closed' });
    expect(events).toMatchObject([{ kind: 'status', state: 'working' }, { kind: 'artifact', parts: [{ kind: 'text', text: '4 EUR' }] }, { kind: 'status', state: 'completed' }]);
    expect(received[0]?.body).toMatchObject({ method: 'SubscribeToTask', params: { id: 'task-1' } });
  });

  it('ends broken when the stream is cut, after the events it sent', async () => {
    handle = (request, response) => {
      sse(response, { id: idOf(request.body), results: [{ statusUpdate: { taskId: 'task-1', contextId: 'ctx-1', status: { state: 'TASK_STATE_WORKING' } } }], isCut: true });
    };
    const events: unknown[] = [];

    const end = await agents.subscribe(rpc(undefined, true), { taskId: 'task-1', timeoutMs: 1_000, signal: new AbortController().signal, onEvent: (event) => Promise.resolve(void events.push(event)) });

    expect({ end: end.kind, events: events.length }).toEqual({ end: 'broken', events: 1 });
  });

  it('ends broken at the timeout of a stream that sends nothing', async () => {
    handle = (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
    };

    await expect(agents.subscribe(rpc(undefined, true), { taskId: 'task-1', timeoutMs: 200, signal: new AbortController().signal, onEvent: () => Promise.resolve() })).resolves.toMatchObject({ kind: 'broken' });
  });

  it('ends gone for a task the agent knows no more', async () => {
    handle = (request, response) => {
      rpcAnswer(response, { id: idOf(request.body), error: { code: -32001, message: 'Task not found' } });
    };

    await expect(agents.subscribe(rpc(undefined, true), { taskId: 'task-1', timeoutMs: 1_000, signal: new AbortController().signal, onEvent: () => Promise.resolve() })).resolves.toMatchObject({ kind: 'gone' });
  });
});

describe("the gateway's own A2A statuses (slice 6)", () => {
  it('tells failed or rejected as a status update with the reason as its message', () => {
    expect(JSON.parse(gatewayStatuses.statusOf({ taskId: 'task-1', contextId: 'ctx-1', state: 'failed', reason: 'No end within 60000 ms', messageId: 'g-1' }).json)).toEqual({
      statusUpdate: { taskId: 'task-1', contextId: 'ctx-1', status: { state: 'TASK_STATE_FAILED', message: { messageId: 'g-1', taskId: 'task-1', contextId: 'ctx-1', role: 'ROLE_AGENT', parts: [{ text: 'No end within 60000 ms' }] } } },
    });
  });
});
