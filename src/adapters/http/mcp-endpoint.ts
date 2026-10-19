/**
 * The gateway's MCP endpoint for outside MCP clients (interop 3.3), over
 * Streamable HTTP and stateless: each request is served by a fresh server for
 * the client its access token names. No token, or one the gateway did not
 * issue for this endpoint, gets 401 with where to sign in (RFC 9728).
 */
import { createMcpHandler, isCallToolResult, McpServer } from '@modelcontextprotocol/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { AccessTokenHolder, AuthenticateAccessToken } from '../../core/oauth/authenticate-access-token.js';
import type { CallTool } from '../../core/mcp-in/call-tool.js';
import type { ListTools } from '../../core/mcp-in/list-tools.js';
import type { ReadCall, ReadClientCall } from '../../core/mcp-in/read-client-call.js';
import { isToolResultType } from '../../core/mcp-out/content-types.js';
import { runningVersion } from './version.js';

const HTTP_UNAUTHORIZED = 401;

export interface McpEndpointDeps {
  /** The MCP endpoint's URL, as tokens are bound to it. */
  resource: string;
  authenticateAccessToken: AuthenticateAccessToken;
  listTools: ListTools;
  callTool: CallTool;
  readClientCall: ReadClientCall;
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
      return toolError('The call got no answer before its deadline. It may have run all the same.');
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
  const mcp = new McpServer({ name: 'aeolus-gateway', version: runningVersion() }, { capabilities: { tools: {} } });
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
  mcp.server.setRequestHandler('tools/call', async (request) => {
    const caller = { fleetId: holder.fleetId, party: holder.party };
    if (request.params.name === RESULT_TOOL.name) {
      const sent = resultArgumentsSchema.safeParse(request.params.arguments);
      if (!sent.success) {
        return toolError('aeolus_result takes the handle a tool answered');
      }
      const read = await deps.readClientCall(caller, sent.data.handle);
      return read.isOk ? resultOf(read.value) : toolError(read.error.message);
    }
    const values = argumentsSchema.safeParse(request.params.arguments);
    if (!values.success) {
      return toolError('A tool takes its arguments as an object');
    }
    const called = await deps.callTool(caller, { name: request.params.name, arguments: values.data });
    return called.isOk ? resultOf(called.value) : toolError(called.error.message);
  });
  return mcp;
}

export function registerMcpEndpoint(server: FastifyInstance, deps: McpEndpointDeps): void {
  const resourceMetadata = `${new URL(deps.resource).origin}/.well-known/oauth-protected-resource${new URL(deps.resource).pathname}`;
  const unauthorized = (reply: FastifyReply, error: string | undefined) =>
    reply
      .code(HTTP_UNAUTHORIZED)
      .header('www-authenticate', `Bearer ${error === undefined ? '' : `error="${error}", `}resource_metadata="${resourceMetadata}"`)
      .send({ error: error ?? 'unauthorized' });

  server.all(new URL(deps.resource).pathname, async (request, reply) => {
    const authorization = request.headers.authorization;
    if (authorization?.startsWith('Bearer ') !== true) {
      return unauthorized(reply, undefined);
    }
    const holder = await deps.authenticateAccessToken(authorization.slice('Bearer '.length));
    if (!holder.isOk) {
      return unauthorized(reply, 'invalid_token');
    }
    const handler = createMcpHandler(() => serverFor(holder.value, deps));
    return handler.fetch(webRequestOf(request), { parsedBody: request.body });
  });
}
