/**
 * The gateway's MCP endpoint for outside MCP clients (interop 3.3), over
 * Streamable HTTP and stateless: each request is served by a fresh server for
 * the client its access token names. No token, or one the gateway did not
 * issue for this endpoint, gets 401 with where to sign in (RFC 9728).
 */
import { CLIENT_CAPABILITIES_META_KEY, createMcpHandler, isCallToolResult, McpServer, ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { AccessTokenHolder, AuthenticateAccessToken } from '../../core/oauth/authenticate-access-token.js';
import type { CallTool } from '../../core/mcp-in/call-tool.js';
import type { ListTools } from '../../core/mcp-in/list-tools.js';
import type { ReadCall, ReadClientCall } from '../../core/mcp-in/read-client-call.js';
import type { IsPerson } from '../../core/people/is-person.js';
import type { AnswerDelivery } from '../../core/people/answer-delivery.js';
import type { DoneDelivery } from '../../core/people/done-delivery.js';
import type { OpenDelivery } from '../../core/people/open-delivery.js';
import type { ReadInbox } from '../../core/people/read-inbox.js';
import { isToolResultType } from '../../core/mcp-out/content-types.js';
import { FLEET_ENDPOINT_PATH } from '../crypto/fleet-endpoints.js';
import { createdTaskOf, DEADLINE_PASSED, taskOf, TASKS_EXTENSION } from './mcp-task.js';
import { personServerFor } from './person-tools.js';
import { runningVersion } from './version.js';

const HTTP_UNAUTHORIZED = 401;

export interface McpEndpointDeps {
  /** The gateway's public URL: each fleet's MCP endpoint is under it, as its tokens are bound to it. */
  issuer: string;
  authenticateAccessToken: AuthenticateAccessToken;
  listTools: ListTools;
  callTool: CallTool;
  readClientCall: ReadClientCall;
  isPerson: IsPerson;
  readInbox: ReadInbox;
  openDelivery: OpenDelivery;
  answerDelivery: AnswerDelivery;
  doneDelivery: DoneDelivery;
}

/** The gateway's own tool: the answer to a call that answered a handle. */
const RESULT_TOOL = {
  name: 'aeolus_result',
  title: 'Read a call',
  description: "A call's state and, once it is answered, its answer. Call it with the handle a tool answered, and again later while the call is not answered.",
  inputSchema: { type: 'object' as const, properties: { handle: { type: 'string' } }, required: ['handle'] },
};

const argumentsSchema = z.record(z.string(), z.unknown()).default({});
const resultArgumentsSchema = z.object({ handle: z.string() });
const taskParamsSchema = z.looseObject({ taskId: z.string() });
/** The capabilities a client declares on each request (2026-07-28), as far as the gateway reads them. */
const envelopeSchema = z.object({ [CLIENT_CAPABILITIES_META_KEY]: z.object({ extensions: z.record(z.string(), z.unknown()).optional() }).optional() });

/** Whether the client declared the Tasks extension on this request: only then may it be answered a task. */
const isTaskClient = (envelope: unknown) => envelopeSchema.safeParse(envelope).data?.[CLIENT_CAPABILITIES_META_KEY]?.extensions?.[TASKS_EXTENSION] !== undefined;

/** tools/call's params, as the gateway reads them: its result may be a task, which the SDK's own tools/call does not type. */
const callParamsSchema = z.looseObject({ name: z.string(), arguments: z.unknown().optional() });

/** A tool's answer as one text block of JSON. */
const answered = (value: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], ...(isError ? { isError } : {}) });

/** A tool error the client's model reads: what went wrong, never a fleet's reasons. */
const toolError = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

/** An answer that is an outside tool's result, as MCP out replies one, if it parses as one. */
function toolResultOf(payload: string) {
  try {
    const parsed: unknown = JSON.parse(payload);
    return isCallToolResult(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** What aeolus_result answers: the call's answer once completed, as the tool's own result where it is one; else its state. */
function resultOf(read: ReadCall) {
  switch (read.state) {
    case 'completed':
      return (isToolResultType(read.answer.contentType) ? toolResultOf(read.answer.payload) : undefined) ?? { content: [{ type: 'text' as const, text: read.answer.payload }] };
    case 'failed':
      return toolError(DEADLINE_PASSED);
    case 'submitted':
    case 'working':
      return answered({ handle: read.handle, state: read.state });
  }
}

/** The request as the SDK's web-standard handler takes it. Fastify has read the JSON body already. */
function webRequestOf(request: FastifyRequest): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    for (const each of Array.isArray(value) ? value : [value]) {
      if (each !== undefined) {
        headers.append(name, each);
      }
    }
  }
  return new Request(new URL(request.url, `${request.protocol}://${request.host}`), { method: request.method, headers });
}

/** A JSON Schema of an object, as MCP's tool takes one. */
const objectSchema = z.object({ type: z.literal('object') }).catchall(z.json());

/** The MCP server one request of one client is served by. Its tools are known per request, from the fleet, so it lists them itself. */
function serverFor(holder: AccessTokenHolder, deps: McpEndpointDeps): McpServer {
  const mcp = new McpServer({ name: 'aeolus-gateway', version: runningVersion() }, { capabilities: { tools: {}, extensions: { [TASKS_EXTENSION]: {} } } });
  mcp.server.setRequestHandler('tools/list', async () => {
    const listed = await deps.listTools({ fleetId: holder.fleetId, party: holder.party });
    if (!listed.isOk) {
      throw new Error(listed.error.message);
    }
    // Where each call goes stays with the gateway: the client sees aliases only.
    return {
      tools: listed.value.map(({ name, title, description, inputSchema }) => ({
        name,
        ...(title === undefined ? {} : { title }),
        description,
        inputSchema: objectSchema.parse(inputSchema),
      })).concat(RESULT_TOOL),
    };
  });
  mcp.server.setRequestHandler('tools/call', { params: callParamsSchema }, async (params, ctx) => {
    const caller = { fleetId: holder.fleetId, party: holder.party };
    if (params.name === RESULT_TOOL.name) {
      const sent = resultArgumentsSchema.safeParse(params.arguments);
      if (!sent.success) {
        return toolError('aeolus_result takes the handle a tool answered');
      }
      const read = await deps.readClientCall(caller, sent.data.handle);
      return read.isOk ? resultOf(read.value) : toolError(read.error.message);
    }
    const values = argumentsSchema.safeParse(params.arguments);
    if (!values.success) {
      return toolError('A tool takes its arguments as an object');
    }
    const called = await deps.callTool(caller, { name: params.name, arguments: values.data });
    if (!called.isOk) {
      return toolError(called.error.message);
    }
    const isUnanswered = called.value.state === 'submitted' || called.value.state === 'working';
    return isUnanswered && isTaskClient(ctx.mcpReq.envelope) ? createdTaskOf(called.value) : resultOf(called.value);
  });
  /** The party's own call by its task id; another party's or none is an error. */
  const readTask = async (taskId: string) => {
    const read = await deps.readClientCall({ fleetId: holder.fleetId, party: holder.party }, taskId);
    if (!read.isOk) {
      throw new ProtocolError(ProtocolErrorCode.InvalidParams, `No task ${taskId} of this party`);
    }
    return read.value;
  };
  mcp.server.setRequestHandler('tasks/get', { params: taskParamsSchema }, async ({ taskId }) => taskOf(await readTask(taskId), resultOf));
  // Acknowledged and nothing changes: a sent call cannot be unsent, and no call asks for input yet.
  for (const method of ['tasks/cancel', 'tasks/update']) {
    mcp.server.setRequestHandler(method, { params: taskParamsSchema }, async ({ taskId }) => {
      await readTask(taskId);
      return {};
    });
  }
  return mcp;
}

export function registerMcpEndpoint(server: FastifyInstance, deps: McpEndpointDeps): void {
  const endpointPath = `${new URL(deps.issuer).pathname.replace(/\/$/, '')}${FLEET_ENDPOINT_PATH}`;
  const unauthorized = (reply: FastifyReply, failure: { error: string | undefined; resource: string }) => {
    const resourceMetadata = `${new URL(failure.resource).origin}/.well-known/oauth-protected-resource${new URL(failure.resource).pathname}`;
    return reply
      .code(HTTP_UNAUTHORIZED)
      .header('www-authenticate', `Bearer ${failure.error === undefined ? '' : `error="${failure.error}", `}resource_metadata="${resourceMetadata}"`)
      .send({ error: failure.error ?? 'unauthorized' });
  };

  // A token is taken only at the fleet's endpoint it was issued for, so the alias needs no lookup here.
  server.all<{ Params: { alias: string } }>(endpointPath, async (request, reply) => {
    const resource = `${deps.issuer}${FLEET_ENDPOINT_PATH.replace(':alias', request.params.alias)}`;
    const authorization = request.headers.authorization;
    if (authorization?.startsWith('Bearer ') !== true) {
      return unauthorized(reply, { error: undefined, resource });
    }
    const holder = await deps.authenticateAccessToken(authorization.slice('Bearer '.length), resource);
    if (!holder.isOk) {
      return unauthorized(reply, { error: 'invalid_token', resource });
    }
    // A person's ship is served the person's own tools; any other party, the fleet's.
    const isPerson = await deps.isPerson(holder.value);
    const handler = createMcpHandler(() => (isPerson ? personServerFor(holder.value, deps) : serverFor(holder.value, deps)));
    return handler.fetch(webRequestOf(request), { parsedBody: request.body });
  });
}
