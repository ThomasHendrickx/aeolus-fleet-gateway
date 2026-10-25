/**
 * The 50-tool test server (gateway scopes 4.3, A6): an outside MCP server as
 * large as the one the design sets scopes on, over Streamable HTTP on a free
 * local port, asking for no credential. Of its tools, 31 the server says read
 * only (readOnlyHint), 14 change or destroy (readOnlyHint false, the three
 * delete tools destructiveHint too), and 5 give no hint. Each answers its own
 * name, and it counts every call it ran.
 */
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';

const ENTITIES = ['leads', 'contacts', 'accounts', 'deals', 'notes', 'tasks', 'meetings', 'campaigns', 'products', 'quotes'];
const one = (entity: string) => entity.slice(0, -1);

/** The tools the server says read only. */
export const READ_ONLY_TOOLS = [
  ...ENTITIES.map((entity) => `list_${entity}`),
  ...ENTITIES.map((entity) => `get_${one(entity)}`),
  ...['leads', 'contacts', 'accounts', 'deals', 'notes'].map((entity) => `search_${entity}`),
  'count_leads',
  'count_deals',
  'count_tasks',
  'report_pipeline',
  'report_revenue',
  'report_activity',
];

/** The tools the server says change what they reach; the delete tools destroy it too. */
export const CHANGING_TOOLS = ['create_lead', 'create_contact', 'create_deal', 'create_note', 'create_task', 'update_lead', 'update_contact', 'update_deal', 'update_task', 'assign_lead', 'close_deal'];
export const DESTRUCTIVE_TOOLS = ['delete_lead', 'delete_deal', 'delete_note'];

/** The tools that give no hint. */
export const HINTLESS_TOOLS = ['ping', 'sync_calendar', 'import_leads', 'send_email', 'enrich_contact'];

export const EVERY_FIFTY_TOOL = [...READ_ONLY_TOOLS, ...CHANGING_TOOLS, ...DESTRUCTIVE_TOOLS, ...HINTLESS_TOOLS];

export interface FiftyTools {
  /** The Streamable HTTP endpoint, such as `http://127.0.0.1:41234/mcp`. */
  url: string;
  /** How often each tool ran, by name. */
  calls: Map<string, number>;
  close(): Promise<void>;
}

function annotationsOf(tool: string) {
  if (READ_ONLY_TOOLS.includes(tool)) {
    return { readOnlyHint: true };
  }
  if (DESTRUCTIVE_TOOLS.includes(tool)) {
    return { readOnlyHint: false, destructiveHint: true };
  }
  return CHANGING_TOOLS.includes(tool) ? { readOnlyHint: false } : undefined;
}

function fiftyServer(server: FiftyTools): McpServer {
  const mcp = new McpServer({ name: 'fifty-tools', version: '1.0.0' }, { capabilities: { tools: {} } });
  for (const tool of EVERY_FIFTY_TOOL) {
    const annotations = annotationsOf(tool);
    mcp.registerTool(tool, { description: `The ${tool.replaceAll('_', ' ')} tool of the test CRM.`, inputSchema: z.object({}), ...(annotations === undefined ? {} : { annotations }) }, () => {
      server.calls.set(tool, (server.calls.get(tool) ?? 0) + 1);
      return { content: [{ type: 'text' as const, text: tool }] };
    });
  }
  return mcp;
}

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

/** Starts the 50-tool test server on a free local port. */
export async function startFiftyTools(): Promise<FiftyTools> {
  const http = Fastify({ logger: false });
  const server: FiftyTools = { url: '', calls: new Map(), close: () => http.close() };
  http.all('/mcp', async (request) => createMcpHandler(() => fiftyServer(server)).fetch(webRequestOf(request), { parsedBody: request.body }));
  const address = await http.listen({ host: '127.0.0.1', port: 0 });
  server.url = `${address}/mcp`;
  return server;
}
