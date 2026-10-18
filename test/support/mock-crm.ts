/**
 * A mock CRM: the outside MCP server the MCP out tests call, over Streamable
 * HTTP on a free local port. It keeps contacts and deals in memory, and
 * counts every call it ran, so a test sees whether a call ran twice.
 *
 * - `list_contacts`, `create_contact`, `list_deals`, `create_deal`: the CRM itself.
 * - `forecast_revenue`: the slow tool; it answers after `slowToolMs`, or never while `isSlowToolHeld`.
 * - `sync_ledger`: the tool that errors; it answers an error result (`isError`).
 *
 * It signs callers in by a static bearer token, or by OAuth client
 * credentials: RFC 9728 protected resource metadata, RFC 8414 authorization
 * server metadata and a token endpoint taking `client_secret_basic`.
 */
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';

export const MOCK_CRM_BEARER = 'crm-static-bearer-token';
export const MOCK_CRM_CLIENT = { clientId: 'aeolus-gateway', clientSecret: 'crm-client-secret' };

/** The access token the token endpoint issues for the client credentials. */
const ISSUED_ACCESS_TOKEN = 'crm-issued-access-token';
const ACCESS_TOKEN_LIFETIME_SECONDS = 3600;
const HTTP_UNAUTHORIZED = 401;
const HTTP_BAD_REQUEST = 400;

export interface MockCrmOptions {
  /** How long `forecast_revenue` takes. */
  slowToolMs?: number;
}

export interface Contact {
  id: string;
  name: string;
  email: string;
}

export interface Deal {
  id: string;
  contactId: string;
  title: string;
  amount: number;
}

export interface MockCrm {
  /** The Streamable HTTP endpoint, such as `http://127.0.0.1:41234/mcp`. */
  url: string;
  contacts: Contact[];
  deals: Deal[];
  /** How often each tool ran, by name. */
  calls: Map<string, number>;
  /** While true, `forecast_revenue` never answers: a call the gateway sent and gets no answer to. */
  isSlowToolHeld: boolean;
  close(): Promise<void>;
}

const textOf = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }];

function crmServer(crm: MockCrm, options: MockCrmOptions): McpServer {
  const mcp = new McpServer({ name: 'mock-crm', version: '1.0.0' }, { capabilities: { tools: {} } });
  const counted = (name: string) => {
    crm.calls.set(name, (crm.calls.get(name) ?? 0) + 1);
  };

  mcp.registerTool(
    'list_contacts',
    {
      title: 'List contacts',
      description: 'The contacts whose name holds the query, or every contact.',
      inputSchema: z.object({ query: z.string().optional() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    ({ query }) => {
      counted('list_contacts');
      const contacts = crm.contacts.filter((contact) => query === undefined || contact.name.includes(query));
      return { content: textOf(contacts), structuredContent: { contacts } };
    },
  );

  mcp.registerTool(
    'create_contact',
    {
      title: 'Create a contact',
      description: 'Adds a contact; each call adds one.',
      inputSchema: z.object({ name: z.string(), email: z.string() }),
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    ({ name, email }) => {
      counted('create_contact');
      const contact = { id: `c${String(crm.contacts.length + 1)}`, name, email };
      crm.contacts.push(contact);
      return { content: textOf(contact), structuredContent: { contact } };
    },
  );

  mcp.registerTool(
    'list_deals',
    {
      title: 'List deals',
      description: "A contact's deals, or every deal.",
      inputSchema: z.object({ contactId: z.string().optional() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    ({ contactId }) => {
      counted('list_deals');
      const deals = crm.deals.filter((deal) => contactId === undefined || deal.contactId === contactId);
      return { content: textOf(deals), structuredContent: { deals } };
    },
  );

  mcp.registerTool(
    'create_deal',
    {
      title: 'Create a deal',
      description: 'Opens a deal for a contact; each call opens one.',
      inputSchema: z.object({ contactId: z.string(), title: z.string(), amount: z.number() }),
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    ({ contactId, title, amount }) => {
      counted('create_deal');
      const deal = { id: `d${String(crm.deals.length + 1)}`, contactId, title, amount };
      crm.deals.push(deal);
      return { content: textOf(deal), structuredContent: { deal } };
    },
  );

  mcp.registerTool(
    'forecast_revenue',
    {
      title: 'Forecast revenue',
      description: 'The sum of every open deal, after a slow computation.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      counted('forecast_revenue');
      await new Promise((resolve) => setTimeout(resolve, options.slowToolMs ?? 0));
      while (crm.isSlowToolHeld) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const total = crm.deals.reduce((sum, deal) => sum + deal.amount, 0);
      return { content: textOf({ total }), structuredContent: { total } };
    },
  );

  mcp.registerTool(
    'sync_ledger',
    {
      title: 'Sync the ledger',
      description: 'Pushes deals to the ledger, which is always down.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    () => {
      counted('sync_ledger');
      return { content: [{ type: 'text' as const, text: 'The ledger is unreachable: connection refused' }], isError: true };
    },
  );

  return mcp;
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

const basicCredentials = z.string().regex(/^Basic /);

function isSignedIn(request: FastifyRequest): boolean {
  const authorization = request.headers.authorization;
  return authorization === `Bearer ${MOCK_CRM_BEARER}` || authorization === `Bearer ${ISSUED_ACCESS_TOKEN}`;
}

function tokenEndpoint(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const authorization = basicCredentials.safeParse(request.headers.authorization);
  const expected = `Basic ${Buffer.from(`${MOCK_CRM_CLIENT.clientId}:${MOCK_CRM_CLIENT.clientSecret}`).toString('base64')}`;
  const grant = z.object({ grant_type: z.literal('client_credentials') }).safeParse(request.body);
  if (!authorization.success || authorization.data !== expected) {
    return reply.code(HTTP_UNAUTHORIZED).send({ error: 'invalid_client' });
  }
  if (!grant.success) {
    return reply.code(HTTP_BAD_REQUEST).send({ error: 'unsupported_grant_type' });
  }
  return reply.send({ access_token: ISSUED_ACCESS_TOKEN, token_type: 'Bearer', expires_in: ACCESS_TOKEN_LIFETIME_SECONDS });
}

/** Starts the mock CRM on a free local port, with a contact and a deal in it. */
export async function startMockCrm(options: MockCrmOptions = {}): Promise<MockCrm> {
  const server = Fastify({ logger: false });
  // Fastify's parser callback takes the request, the body and done: three parameters, its own shape.
  // eslint-disable-next-line @typescript-eslint/max-params
  server.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(typeof body === 'string' ? body : body.toString())));
  });
  const crm: MockCrm = {
    url: '',
    contacts: [{ id: 'c1', name: 'Ada Lovelace', email: 'ada@example.com' }],
    deals: [{ id: 'd1', contactId: 'c1', title: 'Analytical engine', amount: 1200 }],
    calls: new Map(),
    isSlowToolHeld: false,
    close: async () => {
      crm.isSlowToolHeld = false;
      await server.close();
    },
  };
  const origin = () => new URL(crm.url).origin;

  server.get('/.well-known/oauth-protected-resource/mcp', () => ({ resource: crm.url, authorization_servers: [origin()] }));
  server.get('/.well-known/oauth-protected-resource', () => ({ resource: crm.url, authorization_servers: [origin()] }));
  server.get('/.well-known/oauth-authorization-server', () => ({
    issuer: origin(),
    token_endpoint: `${origin()}/token`,
    grant_types_supported: ['client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_basic'],
    response_types_supported: ['token'],
  }));
  server.post('/token', tokenEndpoint);
  server.all('/mcp', async (request, reply) => {
    if (!isSignedIn(request)) {
      return reply
        .code(HTTP_UNAUTHORIZED)
        .header('www-authenticate', `Bearer resource_metadata="${origin()}/.well-known/oauth-protected-resource/mcp"`)
        .send({ error: 'invalid_token' });
    }
    const handler = createMcpHandler(() => crmServer(crm, options));
    return handler.fetch(webRequestOf(request), { parsedBody: request.body });
  });

  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  crm.url = `${address}/mcp`;
  return crm;
}
