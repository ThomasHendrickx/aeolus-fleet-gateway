import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { HEADS_MEETING_ID, aMeetingRead } from '../../../test/support/meeting-fakes.js';
import { CHARLOTTE_GRANT, SENT_MESSAGE_ID } from '../../../test/support/people-fakes.js';
import type { ChangeOwnMic } from '../../core/meetings/change-own-mic.js';
import type { ReadMeeting } from '../../core/meetings/read-meeting.js';
import type { DoneDelivery } from '../../core/people/done-delivery.js';
import type { PersonDiscovery } from '../../core/people/ports.js';
import type { SendMessage } from '../../core/people/send-message.js';
import { err, ok } from '../../core/shared/result.js';
import { personServerFor, type PersonToolsDeps } from './person-tools.js';

// A signed-in person's MCP client starts a message: aeolus_ships says what
// their person ship may send to, and aeolus_send sends as it (aeolus-fleet
// #1046). The tools only translate; the use cases decide.

const DISCOVERY: PersonDiscovery = { ships: [{ name: 'tracker', type: 'issue-tracker', kind: 'app', statement: null }], types: [{ type: 'issue-tracker', reachable: 1 }] };

/** The text of a tool's first content block. */
function textOf(called: Awaited<ReturnType<Client['callTool']>>): string {
  const [first] = z.array(z.object({ text: z.string() })).parse(called.content);
  return first?.text ?? '';
}

const unused = () => Promise.reject(new Error('not called in this test'));

/** The person tools over use cases that answer as given, and what aeolus_send was asked. */
function personTools(overrides: Partial<PersonToolsDeps> = {}) {
  const asked: Parameters<SendMessage>[0][] = [];
  const deps: PersonToolsDeps = {
    readInbox: unused,
    openDelivery: unused,
    answerDelivery: unused,
    doneDelivery: unused,
    askForServer: unused,
    readMeeting: unused,
    changeOwnMic: unused,
    // A fleet that does not answer the inbox state, so each answer goes alone; the state's own tests give it.
    readInboxState: () => Promise.resolve(err({ kind: 'FLEET_UNAVAILABLE', message: 'The fleet did not answer' })),
    listShips: () => Promise.resolve(ok(DISCOVERY)),
    sendMessage: (input) => {
      asked.push(input);
      return Promise.resolve(ok({ messageId: SENT_MESSAGE_ID }));
    },
    ...overrides,
  };
  return { deps, asked };
}

/** Where the endpoint serving the tools names its protected resource metadata (RFC 9728). */
const RESOURCE_METADATA = 'http://gateway.example.com/.well-known/oauth-protected-resource/plugin/mcp';

let client: Client | undefined;

afterEach(async () => {
  await client?.close();
});

async function connected(deps: PersonToolsDeps): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await personServerFor({ caller: CHARLOTTE_GRANT, resourceMetadata: RESOURCE_METADATA }, deps).connect(serverSide);
  client = new Client({ name: 'charlotte', version: '1' });
  await client.connect(clientSide);
  return client;
}

/** tools/list as the server sends it, before an SDK client drops what its schema does not name, such as securitySchemes. */
async function rawToolsList(deps: PersonToolsDeps) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await personServerFor({ caller: CHARLOTTE_GRANT, resourceMetadata: RESOURCE_METADATA }, deps).connect(serverSide);
  const received: unknown[] = [];
  clientSide.onmessage = (message) => received.push(message);
  await clientSide.start();
  await clientSide.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'charlotte', version: '1' } } });
  await clientSide.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  await vi.waitFor(() => {
    expect(received).toHaveLength(2);
  });
  await clientSide.close();
  return z
    .object({ result: z.object({ tools: z.array(z.looseObject({ name: z.string(), securitySchemes: z.unknown() })) }) })
    .parse(received[1]).result.tools;
}

describe("a person's MCP client starts a message", () => {
  it('is served by a server named Aeolus', async () => {
    const mcp = await connected(personTools().deps);

    expect(mcp.getServerVersion()?.name).toBe('Aeolus');
  });

  it('is served aeolus_ships and aeolus_send beside the inbox tools', async () => {
    const mcp = await connected(personTools().deps);

    const listed = await mcp.listTools();

    expect(listed.tools.map(({ name }) => name)).toEqual(['aeolus_setup', 'aeolus_inbox', 'aeolus_open', 'aeolus_answer', 'aeolus_done', 'aeolus_ships', 'aeolus_send', 'aeolus_meeting', 'aeolus_request_mic', 'aeolus_withdraw_mic_request', 'aeolus_release_mic', 'aeolus_ask_for_server']);
  });

  it('reads the ships and types their person ship may send to with aeolus_ships', async () => {
    const mcp = await connected(personTools().deps);

    await expect(mcp.callTool({ name: 'aeolus_ships', arguments: {} })).resolves.toEqual({ content: [{ type: 'text', text: JSON.stringify(DISCOVERY) }] });
  });

  it('sends to a ship by its name with aeolus_send, answering the message id', async () => {
    const { deps, asked } = personTools();
    const mcp = await connected(deps);

    const sent = await mcp.callTool({ name: 'aeolus_send', arguments: { ship: 'tracker', contentType: 'text/plain', payload: 'The build is red', idempotencyKey: 'charlotte-1' } });

    expect({ sent, asked }).toEqual({
      sent: { content: [{ type: 'text', text: JSON.stringify({ messageId: SENT_MESSAGE_ID }) }] },
      asked: [{ caller: CHARLOTTE_GRANT, to: { kind: 'ship', name: 'tracker' }, contentType: 'text/plain', payload: 'The build is red', idempotencyKey: 'charlotte-1' }],
    });
  });

  it('sends to any ship of a type with aeolus_send', async () => {
    const { deps, asked } = personTools();
    const mcp = await connected(deps);

    await mcp.callTool({ name: 'aeolus_send', arguments: { type: 'issue-tracker', contentType: 'text/plain', payload: 'The build is red' } });

    expect(asked).toEqual([{ caller: CHARLOTTE_GRANT, to: { kind: 'type', type: 'issue-tracker' }, contentType: 'text/plain', payload: 'The build is red' }]);
  });

  it('contributes to a meeting by its meetingId with aeolus_send', async () => {
    const { deps, asked } = personTools();
    const mcp = await connected(deps);

    await mcp.callTool({ name: 'aeolus_send', arguments: { meeting: HEADS_MEETING_ID, contentType: 'text/plain', payload: 'Marketing is on track' } });

    expect(asked).toEqual([{ caller: CHARLOTTE_GRANT, to: { kind: 'meeting', meetingId: HEADS_MEETING_ID }, contentType: 'text/plain', payload: 'Marketing is on track' }]);
  });

  it.each([
    { what: 'neither a ship nor a type', given: { contentType: 'text/plain', payload: 'Hello' } },
    { what: 'both a ship and a type', given: { ship: 'tracker', type: 'issue-tracker', contentType: 'text/plain', payload: 'Hello' } },
  ])('refuses aeolus_send given $what, sending nothing', async ({ given }) => {
    const { deps, asked } = personTools();
    const mcp = await connected(deps);

    const sent = await mcp.callTool({ name: 'aeolus_send', arguments: given });

    expect({ sent, asked }).toEqual({
      sent: { content: [{ type: 'text', text: 'aeolus_send takes a ship by its name, a type or a meeting by its id, a contentType and a payload' }], isError: true },
      asked: [],
    });
  });

  it("tells the person the fleet's reason when it refuses the send", async () => {
    const mcp = await connected(personTools({ sendMessage: () => Promise.resolve(err({ kind: 'SEND_REFUSED', message: 'The fleet did not take your message: No active ship is named nobody' })) }).deps);

    await expect(mcp.callTool({ name: 'aeolus_send', arguments: { ship: 'nobody', contentType: 'text/plain', payload: 'Hello' } })).resolves.toEqual({
      content: [{ type: 'text', text: 'The fleet did not take your message: No active ship is named nobody' }],
      isError: true,
    });
  });
});

describe("a person's MCP client finishes a step with aeolus_done (Bridge, CC14)", () => {
  /** The person tools, with what aeolus_done asked. */
  function finishing() {
    const done: Parameters<DoneDelivery>[0][] = [];
    const { deps } = personTools({
      doneDelivery: (input) => {
        done.push(input);
        return Promise.resolve(ok({ deliveryId: input.deliveryId, isHandled: true as const }));
      },
    });
    return { deps, done };
  }

  it('says done or cannot with a note, in a chat', async () => {
    const { deps, done } = finishing();
    const mcp = await connected(deps);

    await mcp.callTool({ name: 'aeolus_done', arguments: { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0s01', outcome: 'cannot', note: 'I have no right to create repositories there' } });

    expect(done).toEqual([{ caller: CHARLOTTE_GRANT, place: 'chat', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0s01', outcome: 'cannot', note: 'I have no right to create repositories there' }]);
  });

  it('is done with a delivery by its id alone, as before', async () => {
    const { deps, done } = finishing();
    const mcp = await connected(deps);

    await mcp.callTool({ name: 'aeolus_done', arguments: { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001' } });

    expect(done).toEqual([{ caller: CHARLOTTE_GRANT, place: 'chat', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001' }]);
  });

  it('refuses an outcome other than done or cannot, asking nothing', async () => {
    const { deps, done } = finishing();
    const mcp = await connected(deps);

    const called = await mcp.callTool({ name: 'aeolus_done', arguments: { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0s01', outcome: 'maybe' } });

    expect({ isError: called.isError, done }).toEqual({ isError: true, done: [] });
  });

  it('says a step outcome and a note in its description, so a chat knows to finish a step with them', async () => {
    const listed = await (await connected(personTools().deps)).listTools();

    expect(listed.tools.find(({ name }) => name === 'aeolus_done')?.inputSchema.properties).toEqual({
      deliveryId: { type: 'string' },
      outcome: { type: 'string', enum: ['done', 'cannot'] },
      note: { type: 'string' },
    });
  });
});

describe("a person's MCP client takes part in a meeting", () => {
  it('reads a meeting, where the person stands on its mic and a page of contributions after the cursor, with aeolus_meeting', async () => {
    const asked: Parameters<ReadMeeting>[0][] = [];
    const readMeeting: ReadMeeting = (input) => {
      asked.push(input);
      return Promise.resolve(ok({ meeting: aMeetingRead(), mic: { kind: 'requested', place: 1 } }));
    };
    const mcp = await connected(personTools({ readMeeting }).deps);

    const read = await mcp.callTool({ name: 'aeolus_meeting', arguments: { meetingId: HEADS_MEETING_ID, cursor: 'msg_01m5qa5j85mgd4z61d9c2k0001' } });

    expect({ read, asked }).toEqual({
      read: { content: [{ type: 'text', text: JSON.stringify({ ...aMeetingRead(), yourMic: { kind: 'requested', place: 1 } }) }] },
      asked: [{ caller: CHARLOTTE_GRANT, meetingId: HEADS_MEETING_ID, cursor: 'msg_01m5qa5j85mgd4z61d9c2k0001' }],
    });
  });

  it.each([
    ['aeolus_request_mic', 'request'],
    ['aeolus_withdraw_mic_request', 'withdraw'],
    ['aeolus_release_mic', 'release'],
  ] as const)('makes the %s call on the meeting', async (name, change) => {
    const asked: Parameters<ChangeOwnMic>[0][] = [];
    const changeOwnMic: ChangeOwnMic = (input) => {
      asked.push(input);
      return Promise.resolve(ok(undefined));
    };
    const mcp = await connected(personTools({ changeOwnMic }).deps);

    const changed = await mcp.callTool({ name, arguments: { meetingId: HEADS_MEETING_ID } });

    expect({ changed, asked }).toEqual({ changed: { content: [{ type: 'text', text: '{}' }] }, asked: [{ caller: CHARLOTTE_GRANT, meetingId: HEADS_MEETING_ID, change }] });
  });

  it("tells the person the fleet's reason when it refuses a mic call", async () => {
    const changeOwnMic: ChangeOwnMic = () => Promise.resolve(err({ kind: 'MIC_REFUSED', message: 'The fleet did not change the mic: You already requested the mic' }));
    const mcp = await connected(personTools({ changeOwnMic }).deps);

    await expect(mcp.callTool({ name: 'aeolus_request_mic', arguments: { meetingId: HEADS_MEETING_ID } })).resolves.toEqual({
      content: [{ type: 'text', text: 'The fleet did not change the mic: You already requested the mic' }],
      isError: true,
    });
  });

  it.each(['aeolus_meeting', 'aeolus_request_mic'])('refuses %s without a meeting id, asking nothing', async (name) => {
    const mcp = await connected(personTools().deps);

    await expect(mcp.callTool({ name, arguments: { meetingId: 'weekly' } })).resolves.toEqual({
      content: [{ type: 'text', text: `${name} takes the meetingId of a meeting you take part in, as its notices name it` }],
      isError: true,
    });
  });
});

describe("a person's tools say what each call does (chatgpt-plugin design, 7.4)", () => {
  it('every person tool carries its three hints, as the table in 7.4 sets them', async () => {
    const mcp = await connected(personTools().deps);

    const listed = await mcp.listTools();

    expect(Object.fromEntries(listed.tools.map(({ name, annotations }) => [name, annotations]))).toEqual({
      aeolus_setup: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      aeolus_inbox: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      aeolus_ships: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      aeolus_meeting: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      aeolus_open: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      aeolus_done: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      aeolus_answer: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      aeolus_send: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      aeolus_request_mic: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      aeolus_withdraw_mic_request: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      aeolus_release_mic: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      aeolus_ask_for_server: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    });
  });

  it('every tool declares sign-in: a securitySchemes entry of type oauth2', async () => {
    const tools = await rawToolsList(personTools().deps);

    expect(tools.map((tool) => [tool.name, tool.securitySchemes])).toEqual(tools.map(({ name }) => [name, [{ type: 'oauth2' }]]));
  });

  it("a person whose sign-in is gone is asked to sign in again: the tool's error carries mcp/www_authenticate naming the resource metadata", async () => {
    const message = 'Your sign-in ended: sign in again from your MCP client';
    const mcp = await connected(personTools({ listShips: () => Promise.resolve(err({ kind: 'SIGNED_OUT', message })) }).deps);

    await expect(mcp.callTool({ name: 'aeolus_ships', arguments: {} })).resolves.toEqual({
      content: [{ type: 'text', text: message }],
      isError: true,
      _meta: { 'mcp/www_authenticate': [`Bearer resource_metadata="${RESOURCE_METADATA}", error="invalid_token", error_description="${message}"`] },
    });
  });
});

describe("a person's chat sets itself up first, saying which client it is (gateway #257)", () => {
  /** What aeolus_setup answered, parsed. */
  async function setUp(client: unknown) {
    const mcp = await connected(personTools().deps);
    const answered = await mcp.callTool({ name: 'aeolus_setup', arguments: { client } });
    const [first] = z.object({ content: z.array(z.object({ text: z.string() })) }).parse(answered).content;
    return z.object({ client: z.string(), rules: z.array(z.string()), oneTimeSetup: z.array(z.string()) }).parse(JSON.parse(first?.text ?? ''));
  }

  it('the server instructions say to call aeolus_setup first in a conversation, naming the clients', async () => {
    const mcp = await connected(personTools().deps);

    expect(mcp.getInstructions()).toBe(
      'Aeolus: your person ship in the fleet, its inbox and its messages. At the start of every conversation, before anything else, call aeolus_setup with the client this chat runs in (claude, claude-code, chatgpt or copilot) and follow what it answers.',
    );
  });

  it("aeolus_setup's description says to call it first, and its client is required, one of the four", async () => {
    const listed = await (await connected(personTools().deps)).listTools();
    const setup = listed.tools.find(({ name }) => name === 'aeolus_setup');

    expect({ starts: setup?.description?.startsWith('Call this first in every conversation, before any other Aeolus tool'), inputSchema: setup?.inputSchema }).toEqual({
      starts: true,
      inputSchema: { type: 'object', properties: { client: { type: 'string', enum: ['claude', 'claude-code', 'chatgpt', 'copilot'] } }, required: ['client'] },
    });
  });

  it('answers claude the Monitor tick first, then the fallback for a chat with no Monitor tool, as Thomas set it on #257', async () => {
    await expect(setUp('claude')).resolves.toMatchObject({
      client: 'claude',
      rules: [
        'Load the Monitor tool (ToolSearch select:Monitor).',
        'Start a Monitor with command `while true; do sleep 120; echo "tick $(date +%H:%M)"; done`, description "person ship inbox tick", timeout_ms 1800000. The shell cannot call the gateway, so the script only ticks; each tick wakes the chat.',
        'On every tick: call aeolus_inbox and compare its deliveryIds with the ones already seen. Something new: show it (sender, title, job; for a question the asker\'s pick), numbered. Do not open it. Nothing new: reply only "." and nothing else.',
        'When the Monitor expires (30 minutes), start it again right away, same command. Never let it lapse.',
        'Never decide, answer or mark done for the person; answer only with their choice, in their words.',
        'If this chat has no Monitor tool, say so, and instead call aeolus_inbox at the start and at the end of every turn.',
      ],
    });
  });

  it('answers claude-code the same rules as claude', async () => {
    const [claude, claudeCode] = [await setUp('claude'), await setUp('claude-code')];

    expect(claudeCode.rules).toEqual(claude.rules);
  });

  it.each([
    { client: 'chatgpt' },
    { client: 'copilot' },
  ])('answers $client, which has no Monitor tool, to check the inbox at the start and end of every turn', async ({ client }) => {
    await expect(setUp(client)).resolves.toMatchObject({
      rules: ['Call aeolus_inbox at the start and at the end of every turn, and say what is new since the last look: sender, title and job, for a question the asker\'s pick, numbered. Do not open it.', 'Never decide, answer or mark done for the person; answer only with their choice, in their words.'],
    });
  });

  it.each([
    { client: 'claude', where: 'profile instructions' },
    { client: 'claude-code', where: 'CLAUDE.md' },
    { client: 'chatgpt', where: 'custom instructions' },
    { client: 'copilot', where: 'personal instructions' },
  ])('walks the person once through setting $client up, in its $where, so every new conversation calls aeolus_setup first', async ({ client, where }) => {
    const { oneTimeSetup } = await setUp(client);

    expect(oneTimeSetup.some((step) => step.includes(where) && step.includes(`call aeolus_setup with client ${client} first`))).toBe(true);
  });

  it.each([{ given: 'gemini' }, { given: undefined }])('refuses a client that is none of the four, given $given', async ({ given }) => {
    const mcp = await connected(personTools().deps);

    await expect(mcp.callTool({ name: 'aeolus_setup', arguments: given === undefined ? {} : { client: given } })).resolves.toEqual({
      content: [{ type: 'text', text: 'aeolus_setup takes the client this chat runs in: claude, claude-code, chatgpt or copilot' }],
      isError: true,
    });
  });
});

describe("every answer of a person's tools carries their inbox state (gateway #256)", () => {
  /** Two deliveries wait on Charlotte and one is opened and not dealt with. */
  const readInboxState = () => Promise.resolve(ok({ waiting: 2, opened: 1 }));
  const INBOX_STATE = { type: 'text', text: "Your inbox state, what waits on you now: {\"waiting\":2,\"opened\":1}. aeolus_inbox lists the items." };

  it("keeps the call's own answer as the first block, unchanged, and gives the inbox state as a second block", async () => {
    const mcp = await connected(personTools({ readInboxState }).deps);

    await expect(mcp.callTool({ name: 'aeolus_ships', arguments: {} })).resolves.toEqual({ content: [{ type: 'text', text: JSON.stringify(DISCOVERY) }, INBOX_STATE] });
  });

  it('gives the inbox state beside a refusal too, the refusal first', async () => {
    const mcp = await connected(personTools({ readInboxState, sendMessage: () => Promise.resolve(err({ kind: 'SEND_REFUSED', message: 'The fleet did not take your message: No active ship is named nobody' })) }).deps);

    await expect(mcp.callTool({ name: 'aeolus_send', arguments: { ship: 'nobody', contentType: 'text/plain', payload: 'Hello' } })).resolves.toEqual({
      content: [{ type: 'text', text: 'The fleet did not take your message: No active ship is named nobody' }, INBOX_STATE],
      isError: true,
    });
  });

  it('reads the state after the call, so a delivery the person is done with counts opened no more', async () => {
    let state = { waiting: 0, opened: 1 };
    const doneDelivery: DoneDelivery = (input) => {
      state = { waiting: 0, opened: 0 };
      return Promise.resolve(ok({ deliveryId: input.deliveryId, isHandled: true as const }));
    };
    const mcp = await connected(personTools({ doneDelivery, readInboxState: () => Promise.resolve(ok(state)) }).deps);

    const done = await mcp.callTool({ name: 'aeolus_done', arguments: { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001' } });

    expect(z.object({ content: z.array(z.object({ text: z.string() })) }).parse(done).content[1]?.text).toBe('Your inbox state, what waits on you now: {"waiting":0,"opened":0}. aeolus_inbox lists the items.');
  });

  it('answers the call alone when the fleet does not answer the inbox state', async () => {
    const mcp = await connected(personTools().deps);

    await expect(mcp.callTool({ name: 'aeolus_ships', arguments: {} })).resolves.toEqual({ content: [{ type: 'text', text: JSON.stringify(DISCOVERY) }] });
  });
});

describe('a person opens a delivery with aeolus_open', () => {
  const OPENED = { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0s02' as const, from: 'chief-of-staff', title: 'You were added to a meeting', sentAt: '2026-10-19T08:00:00.000Z', stale: null };

  it('answers a meeting notice as its sentence, with the meeting to read, and without its payload or content type', async () => {
    const meetingId = 'mtg_01m5qa5j85mgd4z61d9c2k4mtg' as const;
    const opened = { ...OPENED, contentType: 'application/vnd.aeolus.meeting.added+json', payload: `{"meetingId":"${meetingId}"}`, meetingId, said: 'chief-of-staff added you to the meeting “Weekly heads”.' };
    const mcp = await connected(personTools({ openDelivery: () => Promise.resolve(ok(opened)) }).deps);

    const called = await mcp.callTool({ name: 'aeolus_open', arguments: { deliveryId: opened.deliveryId } });

    expect(JSON.parse(textOf(called))).toEqual({ deliveryId: opened.deliveryId, from: 'chief-of-staff', title: 'You were added to a meeting', sentAt: '2026-10-19T08:00:00.000Z', said: opened.said, meetingId });
  });

  it('answers any other delivery whole, as before', async () => {
    const opened = { ...OPENED, contentType: 'text/plain', payload: 'The build is red', meetingId: null, said: null };
    const mcp = await connected(personTools({ openDelivery: () => Promise.resolve(ok(opened)) }).deps);

    const called = await mcp.callTool({ name: 'aeolus_open', arguments: { deliveryId: opened.deliveryId } });

    expect(JSON.parse(textOf(called))).toEqual({ ...OPENED, contentType: 'text/plain', payload: 'The build is red', meetingId: null });
  });
});
