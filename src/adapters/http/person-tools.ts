/**
 * The tools a person's MCP client is served instead of the fleet's (Q20):
 * their own ship's calls, which the gateway makes as the ship's crew, so the
 * chat holds no crew token (interop 3.3 point 5).
 */
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { AnswerDelivery } from '../../core/people/answer-delivery.js';
import type { DoneDelivery } from '../../core/people/done-delivery.js';
import type { OpenDelivery } from '../../core/people/open-delivery.js';
import type { PersonCaller, ReadInbox } from '../../core/people/read-inbox.js';
import { runningVersion } from './version.js';

export interface PersonToolsDeps {
  readInbox: ReadInbox;
  openDelivery: OpenDelivery;
  answerDelivery: AnswerDelivery;
  doneDelivery: DoneDelivery;
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

const ANSWER_TOOL = {
  name: 'aeolus_answer',
  title: 'Answer a delivery',
  description: [
    'Answers a delivery you opened, by its deliveryId: your answer goes to its sender, in reply to it, and the delivery is dealt with.',
    'Give the payload and its content type, such as text/plain. A question (application/vnd.aeolus.question+json) is answered with',
    'application/vnd.aeolus.answer+json and the payload {"questionId":"<its id>","option":<a key>,"note":"..."}, or a note alone. At most 64 KB.',
  ].join(' '),
  inputSchema: {
    type: 'object' as const,
    properties: { deliveryId: { type: 'string' }, contentType: { type: 'string' }, payload: { type: 'string' } },
    required: ['deliveryId', 'contentType', 'payload'],
  },
};

const DONE_TOOL = {
  name: 'aeolus_done',
  title: 'Be done with a delivery',
  description: 'Says you dealt with a delivery you opened, by its deliveryId, with no answer.',
  inputSchema: { type: 'object' as const, properties: { deliveryId: { type: 'string' } }, required: ['deliveryId'] },
};

const PERSON_TOOLS = [INBOX_TOOL, OPEN_TOOL, ANSWER_TOOL, DONE_TOOL];

const deliveryArgumentsSchema = z.object({ deliveryId: z.string() });
const answerArgumentsSchema = z.object({ deliveryId: z.string(), contentType: z.string(), payload: z.string() });

/** A tool's answer as one text block of JSON. */
const answered = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });

/** A tool error the person's model reads. */
const toolError = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

/** The MCP server one request of a person's client is served by. */
export function personServerFor(caller: PersonCaller, deps: PersonToolsDeps): McpServer {
  const mcp = new McpServer({ name: 'aeolus-gateway', version: runningVersion() }, { capabilities: { tools: {} } });
  mcp.server.setRequestHandler('tools/list', () => ({ tools: PERSON_TOOLS }));
  mcp.server.setRequestHandler('tools/call', async ({ params }) => {
    switch (params.name) {
      case INBOX_TOOL.name: {
        const read = await deps.readInbox(caller);
        return read.isOk ? answered(read.value) : toolError(read.error.message);
      }
      case OPEN_TOOL.name:
      case DONE_TOOL.name: {
        const sent = deliveryArgumentsSchema.safeParse(params.arguments);
        if (!sent.success) {
          return toolError(`${params.name} takes the deliveryId your inbox lists`);
        }
        const asked = { caller, deliveryId: sent.data.deliveryId };
        const dealt = params.name === OPEN_TOOL.name ? await deps.openDelivery(asked) : await deps.doneDelivery(asked);
        return dealt.isOk ? answered(dealt.value) : toolError(dealt.error.message);
      }
      case ANSWER_TOOL.name: {
        const sent = answerArgumentsSchema.safeParse(params.arguments);
        if (!sent.success) {
          return toolError(`${ANSWER_TOOL.name} takes the deliveryId, a contentType and a payload`);
        }
        const dealt = await deps.answerDelivery({ caller, ...sent.data });
        return dealt.isOk ? answered(dealt.value) : toolError(dealt.error.message);
      }
      default:
        return toolError(`No tool ${params.name}: a person's ship has ${PERSON_TOOLS.map(({ name }) => name).join(', ')}`);
    }
  });
  return mcp;
}
