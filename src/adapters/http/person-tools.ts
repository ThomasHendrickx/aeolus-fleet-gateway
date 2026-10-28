/**
 * The tools a signed-in person's MCP client is served (Q20, decision 0057):
 * their person ship's calls, which the gateway makes as the ship's crew, so
 * the chat holds no crew token: its inbox, and starting a message where the
 * fleet lets it (aeolus-fleet #1046); taking part in a meeting: reading it,
 * contributing and their own mic calls (decision 0061, M19); and asking for
 * an outside MCP server as their account (decision 0056). Each tool states
 * what its call does in its three hints and that it needs the person's
 * sign-in, as ChatGPT's plugin directory reads them (chatgpt-plugin design,
 * 7.4).
 */
import { idSchema } from '@aeolus-fleet/common';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { ChangeOwnMic } from '../../core/meetings/change-own-mic.js';
import type { OwnMicChange } from '../../core/meetings/ports.js';
import type { ReadMeeting } from '../../core/meetings/read-meeting.js';
import type { AnswerDelivery } from '../../core/people/answer-delivery.js';
import type { DoneDelivery } from '../../core/people/done-delivery.js';
import type { ListShips } from '../../core/people/list-ships.js';
import type { OpenDelivery } from '../../core/people/open-delivery.js';
import type { GrantCaller } from '../../core/people/person-crew.js';
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
  readMeeting: ReadMeeting;
  changeOwnMic: ChangeOwnMic;
  askForServer: AskForServer;
}

/** What a call does, each hint stated: no tool deletes or overwrites, so none is destructive. */
const READS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
/** Changes only the person's own inbox or place in a meeting's line. */
const CHANGES_OWN = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
/** Reaches another party: a message to a ship, or a request to an approver. */
const REACHES_OTHERS = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

const INBOX_TOOL = {
  name: 'aeolus_inbox',
  title: 'Read your inbox',
  description: [
    'Your person ship\'s inbox, by who sent each delivery, when, and its title, without its content, in two groups:',
    'deliveries, what waits for you, at most 10, with how many wait in all; and opened, what you opened from any client and have not answered or done yet.',
  ].join(' '),
  inputSchema: { type: 'object' as const, properties: {} },
  annotations: READS,
};

const OPEN_TOOL = {
  name: 'aeolus_open',
  title: 'Open a delivery',
  description: 'Opens one delivery your inbox lists, by its deliveryId: who sent it, when, its title, content type and content. Opening it confirms you got it, so it waits no more. One you opened opens again, from any of your clients, until you answer it or are done with it.',
  inputSchema: { type: 'object' as const, properties: { deliveryId: { type: 'string' } }, required: ['deliveryId'] },
  annotations: CHANGES_OWN,
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
  annotations: REACHES_OTHERS,
};

const DONE_TOOL = {
  name: 'aeolus_done',
  title: 'Be done with a delivery',
  description: 'Says you dealt with a delivery you opened, by its deliveryId, with no answer.',
  inputSchema: { type: 'object' as const, properties: { deliveryId: { type: 'string' } }, required: ['deliveryId'] },
  annotations: CHANGES_OWN,
};

const SHIPS_TOOL = {
  name: 'aeolus_ships',
  title: 'Read who you may send to',
  description:
    'The ships and types your person ship may send to now, as your rights and the fleet\'s network rules allow: each ship by its name, with its type, kind and what it offers (its statement), and each type with how many of its ships you reach.',
  inputSchema: { type: 'object' as const, properties: {} },
  annotations: READS,
};

const SEND_TOOL = {
  name: 'aeolus_send',
  title: 'Send a message',
  description: [
    'Sends a message as your person ship to one ship by its name, or to any ship of a type, as aeolus_ships lists them,',
    'or contributes to a meeting you take part in by its meetingId: every other participant gets it, and the fleet takes it only while you hold the mic or moderate.',
    'Give one of ship, type or meeting, the payload and its content type, such as text/plain. To ask a question with numbered options, send application/vnd.aeolus.question+json with the payload',
    '{"id":"<a new uuid>","title":"...","context":"...","options":[{"key":1,"label":"...","detail":"..."}]}. At most 64 KB.',
    'Give an idempotencyKey of your own to send it once when you try again. The fleet decides whether it may go and says why when it may not.',
  ].join(' '),
  inputSchema: {
    type: 'object' as const,
    properties: { ship: { type: 'string' }, type: { type: 'string' }, meeting: { type: 'string' }, contentType: { type: 'string' }, payload: { type: 'string' }, idempotencyKey: { type: 'string' } },
    required: ['contentType', 'payload'],
  },
  annotations: REACHES_OTHERS,
};

const meetingInput = { type: 'object' as const, properties: { meetingId: { type: 'string' } }, required: ['meetingId'] };

const MEETING_TOOL = {
  name: 'aeolus_meeting',
  title: 'Read a meeting',
  description: [
    'A meeting you take part in, by its meetingId, as its notices in your inbox name it: its title, owner and moderator, when it opened and ended,',
    'each participant with whether it is crewed and in the meeting, the mic (its holder, null while free; its pattern; the requests, oldest first),',
    'yourMic (moderating, holding, requested with your place in line, or none), and a page of contributions, newest first.',
    'Give the nextCursor it answered as cursor for older ones. Reading confirms no delivery: contributions still wait in your inbox.',
  ].join(' '),
  inputSchema: { type: 'object' as const, properties: { meetingId: { type: 'string' }, cursor: { type: 'string' } }, required: ['meetingId'] },
  annotations: READS,
};

const REQUEST_MIC_TOOL = {
  name: 'aeolus_request_mic',
  title: 'Request the mic',
  description: [
    'Requests the mic of a meeting you take part in, by its meetingId: only the moderator and the holder of the mic contribute.',
    'Your request keeps its place in line until the moderator gives you the mic or you withdraw it, so a person who reads slowly loses no place.',
    'When you act for the person, you may request it again after each of their contributions. A message of application/vnd.aeolus.meeting.mic+json tells you when you hold it.',
  ].join(' '),
  inputSchema: meetingInput,
  annotations: CHANGES_OWN,
};

const WITHDRAW_MIC_REQUEST_TOOL = {
  name: 'aeolus_withdraw_mic_request',
  title: 'Withdraw your mic request',
  description: 'Withdraws your request for the mic of a meeting, by its meetingId: you leave the line.',
  inputSchema: meetingInput,
  annotations: CHANGES_OWN,
};

const RELEASE_MIC_TOOL = {
  name: 'aeolus_release_mic',
  title: 'Release the mic',
  description: 'Releases the mic you hold in a meeting, by its meetingId, once you are done: it never frees by itself, and the next in line may then get it.',
  inputSchema: meetingInput,
  annotations: CHANGES_OWN,
};

/** The mic call each mic tool makes. */
const MIC_TOOLS = new Map<string, OwnMicChange>([
  [REQUEST_MIC_TOOL.name, 'request'],
  [WITHDRAW_MIC_REQUEST_TOOL.name, 'withdraw'],
  [RELEASE_MIC_TOOL.name, 'release'],
]);

const ASK_FOR_SERVER_TOOL = {
  name: 'aeolus_ask_for_server',
  title: 'Ask for an outside MCP server',
  description:
    'Asks an approver of your fleet to add an outside MCP server, by its https address, so its tools reach the fleet. The approver gives its credential. A request waits 7 days for a decision; another person asking for the same server joins it.',
  inputSchema: { type: 'object' as const, properties: { url: { type: 'string' } }, required: ['url'] },
  annotations: REACHES_OTHERS,
};

/** Every tool needs the person's sign-in (OpenAI's Apps SDK auth). */
const SIGN_IN = [{ type: 'oauth2' as const }];

const PERSON_TOOLS = [INBOX_TOOL, OPEN_TOOL, ANSWER_TOOL, DONE_TOOL, SHIPS_TOOL, SEND_TOOL, MEETING_TOOL, REQUEST_MIC_TOOL, WITHDRAW_MIC_REQUEST_TOOL, RELEASE_MIC_TOOL, ASK_FOR_SERVER_TOOL].map((tool) => ({ ...tool, securitySchemes: SIGN_IN }));

const deliveryArgumentsSchema = z.object({ deliveryId: z.string() });
const askForServerArgumentsSchema = z.object({ url: z.string() });
const answerArgumentsSchema = z.object({ deliveryId: z.string(), contentType: z.string(), payload: z.string() });
const message = { contentType: z.string(), payload: z.string(), idempotencyKey: z.string().optional() };
/** Who a message is for: a ship by its name, a type or a meeting, only one of them. */
const sendArgumentsSchema = z.union([
  z.strictObject({ ship: z.string(), ...message }).transform(({ ship, ...rest }) => ({ to: { kind: 'ship' as const, name: ship }, ...rest })),
  z.strictObject({ type: z.string(), ...message }).transform(({ type, ...rest }) => ({ to: { kind: 'type' as const, type }, ...rest })),
  z.strictObject({ meeting: idSchema('meeting'), ...message }).transform(({ meeting, ...rest }) => ({ to: { kind: 'meeting' as const, meetingId: meeting }, ...rest })),
]);
const meetingArgumentsSchema = z.object({ meetingId: idSchema('meeting'), cursor: idSchema('message').optional() });

const meetingIdRefusal = (name: string) => toolError(`${name} takes the meetingId of a meeting you take part in, as its notices name it`);

/** The refusal of a person whose sign-in ended. */
const SIGNED_OUT = 'SIGNED_OUT';
/** Where a tool result carries the challenge that makes ChatGPT ask the person to sign in again. */
const WWW_AUTHENTICATE_META = 'mcp/www_authenticate';

/** A tool's answer as one text block of JSON. */
const answered = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });

/** A tool error the person's model reads. */
const toolError = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

/** Who a person's tools serve, and where the endpoint serving them names its protected resource metadata (RFC 9728). */
export interface PersonServed {
  caller: GrantCaller;
  resourceMetadata: string;
}

/** The MCP server one request of a person's client is served by. */
export function personServerFor(served: PersonServed, deps: PersonToolsDeps): McpServer {
  const { caller } = served;
  /** A refusal the person's model reads; one whose sign-in ended also tells the client to sign in again (OpenAI's Apps SDK auth). */
  const refused = (error: { kind: string; message: string }) =>
    error.kind === SIGNED_OUT
      ? { ...toolError(error.message), _meta: { [WWW_AUTHENTICATE_META]: [`Bearer resource_metadata="${served.resourceMetadata}", error="invalid_token", error_description="${error.message}"`] } }
      : toolError(error.message);
  const mcp = new McpServer({ name: 'Aeolus', version: runningVersion() }, { capabilities: { tools: {} } });
  mcp.server.setRequestHandler('tools/list', () => ({ tools: PERSON_TOOLS }));
  const changeOwnMic = async (call: { name: string; change: OwnMicChange; args: unknown }) => {
    const sent = meetingArgumentsSchema.omit({ cursor: true }).safeParse(call.args);
    if (!sent.success) {
      return meetingIdRefusal(call.name);
    }
    const changed = await deps.changeOwnMic({ caller, meetingId: sent.data.meetingId, change: call.change });
    return changed.isOk ? answered({}) : refused(changed.error);
  };
  mcp.server.setRequestHandler('tools/call', async ({ params }) => {
    switch (params.name) {
      case INBOX_TOOL.name: {
        const read = await deps.readInbox(caller);
        return read.isOk ? answered(read.value) : refused(read.error);
      }
      case OPEN_TOOL.name:
      case DONE_TOOL.name: {
        const sent = deliveryArgumentsSchema.safeParse(params.arguments);
        if (!sent.success) {
          return toolError(`${params.name} takes the deliveryId your inbox lists`);
        }
        const asked = { caller, deliveryId: sent.data.deliveryId };
        const dealt = params.name === OPEN_TOOL.name ? await deps.openDelivery(asked) : await deps.doneDelivery(asked);
        return dealt.isOk ? answered(dealt.value) : refused(dealt.error);
      }
      case ANSWER_TOOL.name: {
        const sent = answerArgumentsSchema.safeParse(params.arguments);
        if (!sent.success) {
          return toolError(`${ANSWER_TOOL.name} takes the deliveryId, a contentType and a payload`);
        }
        const dealt = await deps.answerDelivery({ caller, ...sent.data });
        return dealt.isOk ? answered(dealt.value) : refused(dealt.error);
      }
      case SHIPS_TOOL.name: {
        const listed = await deps.listShips(caller);
        return listed.isOk ? answered(listed.value) : refused(listed.error);
      }
      case SEND_TOOL.name: {
        const sent = sendArgumentsSchema.safeParse(params.arguments);
        if (!sent.success) {
          return toolError(`${SEND_TOOL.name} takes a ship by its name, a type or a meeting by its id, a contentType and a payload`);
        }
        const { idempotencyKey, ...rest } = sent.data;
        const taken = await deps.sendMessage({ caller, ...rest, ...(idempotencyKey === undefined ? {} : { idempotencyKey }) });
        return taken.isOk ? answered(taken.value) : refused(taken.error);
      }
      case MEETING_TOOL.name: {
        const sent = meetingArgumentsSchema.safeParse(params.arguments);
        if (!sent.success) {
          return meetingIdRefusal(params.name);
        }
        const { cursor, meetingId } = sent.data;
        const read = await deps.readMeeting({ caller, meetingId, ...(cursor === undefined ? {} : { cursor }) });
        return read.isOk ? answered({ ...read.value.meeting, yourMic: read.value.mic }) : refused(read.error);
      }
      case ASK_FOR_SERVER_TOOL.name: {
        const sent = askForServerArgumentsSchema.safeParse(params.arguments);
        if (!sent.success) {
          return toolError(`${ASK_FOR_SERVER_TOOL.name} takes the server's url`);
        }
        const asked = await deps.askForServer({ caller, url: sent.data.url });
        return asked.isOk ? answered({ ...asked.value, expiresAt: asked.value.expiresAt.toISOString() }) : refused(asked.error);
      }
      default: {
        const change = MIC_TOOLS.get(params.name);
        return change === undefined ? toolError(`No tool ${params.name}: your person ship has ${PERSON_TOOLS.map(({ name }) => name).join(', ')}`) : changeOwnMic({ name: params.name, change, args: params.arguments });
      }
    }
  });
  return mcp;
}
