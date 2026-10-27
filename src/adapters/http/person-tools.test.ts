import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { HEADS_MEETING_ID, aMeetingRead } from '../../../test/support/meeting-fakes.js';
import { CHARLOTTE_GRANT, SENT_MESSAGE_ID } from '../../../test/support/people-fakes.js';
import type { ChangeOwnMic } from '../../core/meetings/change-own-mic.js';
import type { ReadMeeting } from '../../core/meetings/read-meeting.js';
import type { PersonDiscovery } from '../../core/people/ports.js';
import type { SendMessage } from '../../core/people/send-message.js';
import { err, ok } from '../../core/shared/result.js';
import { personServerFor, type PersonToolsDeps } from './person-tools.js';

// A signed-in person's MCP client starts a message: aeolus_ships says what
// their person ship may send to, and aeolus_send sends as it (aeolus-fleet
// #1046). The tools only translate; the use cases decide.

const DISCOVERY: PersonDiscovery = { ships: [{ name: 'tracker', type: 'issue-tracker', kind: 'app', statement: null }], types: [{ type: 'issue-tracker', reachable: 1 }] };

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

    expect(listed.tools.map(({ name }) => name)).toEqual(['aeolus_inbox', 'aeolus_open', 'aeolus_answer', 'aeolus_done', 'aeolus_ships', 'aeolus_send', 'aeolus_meeting', 'aeolus_request_mic', 'aeolus_withdraw_mic_request', 'aeolus_release_mic', 'aeolus_ask_for_server']);
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
