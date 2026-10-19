/**
 * The tools a person's MCP client is served instead of the fleet's (Q20):
 * their own ship's calls, which the gateway makes as the ship's crew, so the
 * chat holds no crew token (interop 3.3 point 5).
 */
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { OpenDelivery } from '../../core/people/open-delivery.js';
import type { PersonCaller, ReadInbox } from '../../core/people/read-inbox.js';
import { runningVersion } from './version.js';

export interface PersonToolsDeps {
  readInbox: ReadInbox;
  openDelivery: OpenDelivery;
}

const INBOX_TOOL = {
  name: 'aeolus_inbox',
  title: 'Read your inbox',
  description: 'What waits for you in your ship: who sent each delivery, when, and its title, without its content. Lists at most 10, with how many wait in all.',
  inputSchema: { type: 'object' as const, properties: {} },
};

const OPEN_TOOL = {
  name: 'aeolus_open',
  title: 'Open a delivery',
  description: 'Opens one delivery your inbox lists, by its deliveryId: who sent it, when, its title, content type and content. Opening it confirms you got it, so it waits no more.',
  inputSchema: { type: 'object' as const, properties: { deliveryId: { type: 'string' } }, required: ['deliveryId'] },
};

const openArgumentsSchema = z.object({ deliveryId: z.string() });

/** A tool's answer as one text block of JSON. */
const answered = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });

/** A tool error the person's model reads. */
const toolError = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

/** The MCP server one request of a person's client is served by. */
export function personServerFor(caller: PersonCaller, deps: PersonToolsDeps): McpServer {
  const mcp = new McpServer({ name: 'aeolus-gateway', version: runningVersion() }, { capabilities: { tools: {} } });
  mcp.server.setRequestHandler('tools/list', () => ({ tools: [INBOX_TOOL, OPEN_TOOL] }));
  mcp.server.setRequestHandler('tools/call', async ({ params }) => {
    switch (params.name) {
      case INBOX_TOOL.name: {
        const read = await deps.readInbox(caller);
        return read.isOk ? answered(read.value) : toolError(read.error.message);
      }
      case OPEN_TOOL.name: {
        const sent = openArgumentsSchema.safeParse(params.arguments);
        if (!sent.success) {
          return toolError(`${OPEN_TOOL.name} takes the deliveryId your inbox lists`);
        }
        const opened = await deps.openDelivery({ caller, deliveryId: sent.data.deliveryId });
        return opened.isOk ? answered(opened.value) : toolError(opened.error.message);
      }
      default:
        return toolError(`No tool ${params.name}: a person's ship has ${INBOX_TOOL.name} and ${OPEN_TOOL.name}`);
    }
  });
  return mcp;
}
