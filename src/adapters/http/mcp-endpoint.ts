/**
 * The gateway's MCP endpoint for outside MCP clients (interop 3.3), over
 * Streamable HTTP and stateless: each request is served by a fresh server for
 * the client its access token names. No token, or one the gateway did not
 * issue for this endpoint, gets 401 with where to sign in (RFC 9728).
 */
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { AccessTokenHolder, AuthenticateAccessToken } from '../../core/oauth/authenticate-access-token.js';
import type { ListTools } from '../../core/mcp-in/list-tools.js';
import { runningVersion } from './version.js';

const HTTP_UNAUTHORIZED = 401;

export interface McpEndpointDeps {
  /** The MCP endpoint's URL, as tokens are bound to it. */
  resource: string;
  authenticateAccessToken: AuthenticateAccessToken;
  listTools: ListTools;
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
      tools: listed.value.map(({ name, title, description, inputSchema, outputSchema }) => ({
        name,
        ...(title === undefined ? {} : { title }),
        description,
        inputSchema: objectSchema.parse(inputSchema),
        ...(outputSchema === undefined ? {} : { outputSchema: objectSchema.parse(outputSchema) }),
      })),
    };
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
