/**
 * The tools a signed-in person's MCP client is served (Q20, decision 0057):
 * their person ship's calls, which the gateway makes as the ship's crew, so
 * the chat holds no crew token: its inbox, and starting a message where the
 * fleet lets it (aeolus-fleet #1046); and asking for an outside MCP server
 * as their account (decision 0056).
 */
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { AnswerDelivery } from '../../core/people/answer-delivery.js';
import type { DoneDelivery } from '../../core/people/done-delivery.js';
import type { ListShips } from '../../core/people/list-ships.js';
import type { OpenDelivery } from '../../core/people/open-delivery.js';
import type { PersonCaller } from '../../core/people/person-crew.js';
import type { ReadInbox } from '../../core/people/read-inbox.js';
import type { SendMessage } from '../../core/people/send-message.js';
import type { AskForServer } from '../../core/requests/ask-for-server.js';
import { runningVersion } from './version.js';

export interface PersonToolsDeps {
  readInbox: ReadInbox;
  openDelivery: OpenDelivery;
  answerDelivery: AnswerDelivery;
  doneDelivery: DoneDelivery;
  listShips: ListShips;
  sendMessage: SendMessage;
  askForServer: AskForServer;
}

const INBOX_TOOL = {
  name: 'aeolus_inbox',
  title: 'Read your inbox',
  description: [
    'Your person ship\'s inbox, by who sent each delivery, when, and its title, without its content, in two groups:',
    'deliveries, what waits for you, at most 10, with how many wait in all; and opened, what you opened from any client and have not answered or done yet.',
  ].join(' '),
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

const SHIPS_TOOL = {
  name: 'aeolus_ships',
  title: 'Read who you may send to',
  description:
    'The ships and types your person ship may send to now, as your rights and the fleet\'s network rules allow: each ship by its name, with its type, kind and what it offers (its statement), and each type with how many of its ships you reach.',
  inputSchema: { type: 'object' as const, properties: {} },
};

const SEND_TOOL = {
  name: 'aeolus_send',
  title: 'Send a message',
  description: [
    'Sends a message as your person ship to one ship by its name, or to any ship of a type, as aeolus_ships lists them. Give either ship or type,',
    'the payload and its content type, such as text/plain. To ask a question with numbered options, send application/vnd.aeolus.question+json with the payload',
    '{"id":"<a new uuid>","title":"...","context":"...","options":[{"key":1,"label":"...","detail":"..."}]}. At most 64 KB.',
    'Give an idempotencyKey of your own to send it once when you try again. The fleet decides whether it may go and says why when it may not.',
  ].join(' '),
  inputSchema: {
    type: 'object' as const,
    properties: { ship: { type: 'string' }, type: { type: 'string' }, contentType: { type: 'string' }, payload: { type: 'string' }, idempotencyKey: { type: 'string' } },
    required: ['contentType', 'payload'],
  },
};

const ASK_FOR_SERVER_TOOL = {
  name: 'aeolus_ask_for_server',
  title: 'Ask for an outside MCP server',
  description:
    'Asks an approver of your fleet to add an outside MCP server, by its https address, so its tools reach the fleet. The approver gives its credential. A request waits 7 days for a decision; another person asking for the same server joins it.',
  inputSchema: { type: 'object' as const, properties: { url: { type: 'string' } }, required: ['url'] },
};

const PERSON_TOOLS = [INBOX_TOOL, OPEN_TOOL, ANSWER_TOOL, DONE_TOOL, SHIPS_TOOL, SEND_TOOL, ASK_FOR_SERVER_TOOL];

const deliveryArgumentsSchema = z.object({ deliveryId: z.string() });
const askForServerArgumentsSchema = z.object({ url: z.string() });
const answerArgumentsSchema = z.object({ deliveryId: z.string(), contentType: z.string(), payload: z.string() });
const message = { contentType: z.string(), payload: z.string(), idempotencyKey: z.string().optional() };
/** Who a message is for: a ship by its name or a type, never both. */
const sendArgumentsSchema = z.union([
  z.strictObject({ ship: z.string(), ...message }).transform(({ ship, ...rest }) => ({ to: { kind: 'ship' as const, name: ship }, ...rest })),
  z.strictObject({ type: z.string(), ...message }).transform(({ type, ...rest }) => ({ to: { kind: 'type' as const, type }, ...rest })),
]);

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
      case SHIPS_TOOL.name: {
        const listed = await deps.listShips(caller);
        return listed.isOk ? answered(listed.value) : toolError(listed.error.message);
      }
      case SEND_TOOL.name: {
        const sent = sendArgumentsSchema.safeParse(params.arguments);
        if (!sent.success) {
          return toolError(`${SEND_TOOL.name} takes a ship by its name or a type, a contentType and a payload`);
        }
        const { idempotencyKey, ...rest } = sent.data;
        const taken = await deps.sendMessage({ caller, ...rest, ...(idempotencyKey === undefined ? {} : { idempotencyKey }) });
        return taken.isOk ? answered(taken.value) : toolError(taken.error.message);
      }
      case ASK_FOR_SERVER_TOOL.name: {
        const sent = askForServerArgumentsSchema.safeParse(params.arguments);
        if (!sent.success) {
          return toolError(`${ASK_FOR_SERVER_TOOL.name} takes the server's url`);
        }
        const asked = await deps.askForServer({ caller, url: sent.data.url });
        return asked.isOk ? answered({ ...asked.value, expiresAt: asked.value.expiresAt.toISOString() }) : toolError(asked.error.message);
      }
      default:
        return toolError(`No tool ${params.name}: your person ship has ${PERSON_TOOLS.map(({ name }) => name).join(', ')}`);
    }
  });
  return mcp;
}
