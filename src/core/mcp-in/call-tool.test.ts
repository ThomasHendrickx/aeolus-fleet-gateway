import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aCallReply, aDiscoveredShip, CRM_SHIP_ID, fakeAliases, fakeCallKeys, fakeCallSender, fakeDiscovery, MESSAGE_ID, memoryClientCalls } from '../../../test/support/mcp-in-fakes.js';
import { PROXY_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import type { McpClientParty } from '../parties/party.js';
import type { Sleep } from '../mcp-out/run-party.js';
import type { Clock } from '../shared/clock.js';
import { createCallTool } from './call-tool.js';
import { createListTools, IDEMPOTENCY_ARGUMENT } from './list-tools.js';

const CLAUDE: McpClientParty = {
  fleetId: FLEET_ID,
  name: 'claude',
  kind: 'mcpClient',
  clientId: 'https://claude.example.com/client.json',
  state: 'crewed',
  proxyShipId: PROXY_SHIP_ID,
  secret: null,
  crewToken: 'aeolus_ct_v1_claude',
  requestId: 'r-1',
  requestHash: 'h',
  approvedAt: new Date('2026-10-19T10:00:00.000Z'),
};

const CALLER = { fleetId: FLEET_ID, party: 'claude' };
const NOW = new Date('2026-10-19T12:00:00.000Z');
const DEADLINE_MS = 600_000;
const WAIT_POLL_MS = 250;
const RESULT_TYPE = 'application/vnd.aeolus.mcp-result+json; name=list_deals';

let now: Date;
const clock: Clock = { now: () => now };
let sleeps: number[];
/** What happens in the fleet while the call waits, before each sleep ends. */
let whileWaiting: () => Promise<void>;

/** Each sleep passes its time on the clock. */
const sleep: Sleep = async (ms) => {
  sleeps.push(ms);
  now = new Date(now.getTime() + ms);
  await whileWaiting();
};

let parties: ReturnType<typeof memoryPartyStore>;
let discovery: ReturnType<typeof fakeDiscovery>;
let sender: ReturnType<typeof fakeCallSender>;
let calls: ReturnType<typeof memoryClientCalls>;
let keys: ReturnType<typeof fakeCallKeys>;
let callTool: ReturnType<typeof createCallTool>;

const callToolWaiting = (waitMs: number) =>
  createCallTool({ parties, listTools: createListTools({ parties, discovery, aliases: fakeAliases }), sender, calls, keys, clock, deadlineMs: DEADLINE_MS, sleep, waitMs, waitPollMs: WAIT_POLL_MS });

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(CLAUDE);
  discovery = fakeDiscovery();
  sender = fakeCallSender();
  calls = memoryClientCalls();
  keys = fakeCallKeys();
  now = NOW;
  sleeps = [];
  whileWaiting = () => Promise.resolve();
  callTool = callToolWaiting(0);
});

describe("an outside MCP client's tool call is a message its proxy ship sends (interop 3.3)", () => {
  it("sends the arguments, without the idempotency argument, to the tool's ship as the party's proxy ship, under the capability's input type", async () => {
    await callTool(CALLER, { name: 'a9cr2__list_deals', arguments: { contactId: 'c1', [IDEMPOTENCY_ARGUMENT]: 'k-1' } });

    expect(sender.sent).toEqual([
      {
        crewToken: 'aeolus_ct_v1_claude',
        to: CRM_SHIP_ID,
        contentType: 'application/vnd.aeolus.mcp-tool+json; name=list_deals',
        payload: '{"contactId":"c1"}',
        idempotencyKey: `key(${FLEET_ID}:claude:k-1)`,
      },
    ]);
  });

  it("answers a handle once the fleet answered the send, and keeps the call under it, with the type its answer comes in and its deadline", async () => {
    const called = await callTool(CALLER, { name: 'a9cr2__list_deals', arguments: { contactId: 'c1' } });

    expect(called).toEqual({ isOk: true, value: { handle: `handle(${FLEET_ID}:${MESSAGE_ID})`, createdAt: NOW, updatedAt: NOW, state: 'submitted' } });
    expect(calls.held).toEqual([
      {
        fleetId: FLEET_ID,
        party: 'claude',
        messageId: MESSAGE_ID,
        handle: `handle(${FLEET_ID}:${MESSAGE_ID})`,
        shipId: CRM_SHIP_ID,
        capability: 'list_deals',
        outputContentType: 'application/vnd.aeolus.mcp-result+json; name=list_deals',
        sentAt: NOW,
        deadlineAt: new Date('2026-10-19T12:10:00.000Z'),
        replies: [],
      },
    ]);
  });

  it('sends the same call again under the same idempotency argument as no second message', async () => {
    const call = { name: 'a9cr2__list_deals', arguments: { contactId: 'c1', [IDEMPOTENCY_ARGUMENT]: 'k-1' } };
    const first = await callTool(CALLER, call);
    const again = await callTool(CALLER, call);

    expect({ sent: sender.sent.length, held: calls.held.length, isSame: JSON.stringify(first) === JSON.stringify(again) }).toEqual({ sent: 1, held: 1, isSame: true });
  });

  it('sends each call with no idempotency argument under a new key', async () => {
    const call = { name: 'a9cr2__list_deals', arguments: { contactId: 'c1' } };
    await callTool(CALLER, call);
    await callTool(CALLER, call);

    expect(sender.sent.map((message) => message.idempotencyKey)).toEqual(['new-1', 'new-2']);
  });

  it('keeps no answer type for a capability that states none', async () => {
    discovery.state.ships = [aDiscoveredShip({ statement: { by: 'crew', summary: 's', capabilities: [{ name: 'ping' }] } })];

    await callTool(CALLER, { name: 'a9cr2__ping', arguments: {} });

    expect(calls.held.map((call) => call.outputContentType)).toEqual([null]);
  });

  it("sends a text tool's one argument as plain text", async () => {
    discovery.state.ships = [aDiscoveredShip({ statement: { by: 'crew', summary: 's', capabilities: [{ name: 'ask', inputModes: ['text/plain'] }] } })];

    await callTool(CALLER, { name: 'a9cr2__ask', arguments: { text: 'Which deals close this week?' } });

    expect(sender.sent.map(({ contentType, payload }) => ({ contentType, payload }))).toEqual([{ contentType: 'text/plain', payload: 'Which deals close this week?' }]);
  });

  it.each([
    { what: 'a tool it does not list', call: { name: 'a9cr2__drop_tables', arguments: {} }, kind: 'NO_SUCH_TOOL' },
    { what: 'a text tool without its text', call: { name: 'a9cr2__ask', arguments: { text: 7 } }, kind: 'INVALID_ARGUMENTS' },
    { what: 'an idempotency argument that is not a string', call: { name: 'a9cr2__ask', arguments: { text: 'hi', [IDEMPOTENCY_ARGUMENT]: 7 } }, kind: 'INVALID_ARGUMENTS' },
    { what: 'an empty idempotency argument', call: { name: 'a9cr2__ask', arguments: { text: 'hi', [IDEMPOTENCY_ARGUMENT]: '' } }, kind: 'INVALID_ARGUMENTS' },
  ])('refuses $what, sending nothing', async ({ call, kind }) => {
    discovery.state.ships = [aDiscoveredShip({ statement: { by: 'crew', summary: 's', capabilities: [{ name: 'ask', inputModes: ['text/plain'] }] } })];

    await expect(callTool(CALLER, call)).resolves.toMatchObject({ isOk: false, error: { kind } });
    expect(sender.sent).toEqual([]);
  });

  it.each([
    ['NOT_REACHABLE', 'NOT_REACHABLE'],
    ['UNAVAILABLE', 'FLEET_UNAVAILABLE'],
    ['BAD_REQUEST', 'SEND_REFUSED'],
  ])('refuses a send the fleet answers %s, keeping no call', async (code, kind) => {
    sender.state.refusal = { code, message: 'refused' };

    await expect(callTool(CALLER, { name: 'a9cr2__list_deals', arguments: {} })).resolves.toMatchObject({ isOk: false, error: { kind } });
    expect(calls.held).toEqual([]);
  });

  it('says of a send the fleet did not answer that it may have been sent, and how to call again safely', async () => {
    sender.state.refusal = { code: 'UNAVAILABLE', message: 'The fleet did not answer' };

    const called = await callTool(CALLER, { name: 'a9cr2__list_deals', arguments: {} });

    expect(called.isOk ? '' : called.error.message).toContain(IDEMPOTENCY_ARGUMENT);
  });

  it('refuses a party that is not crewed', async () => {
    await parties.save({ ...CLAUDE, state: 'awaitingCrew', crewToken: null });

    await expect(callTool(CALLER, { name: 'a9cr2__list_deals', arguments: {} })).resolves.toMatchObject({ isOk: false, error: { kind: 'PARTY_NOT_CREWED' } });
  });
});

describe('an outside MCP client waits a bounded time for the answer to its call (interop 3.3)', () => {
  it('is answered the answer itself once it comes within the wait', async () => {
    whileWaiting = () => calls.addReply({ fleetId: FLEET_ID, messageId: MESSAGE_ID }, aCallReply({ contentType: RESULT_TYPE, payload: '{"content":[]}', receivedAt: now }));

    await expect(callToolWaiting(10_000)(CALLER, { name: 'a9cr2__list_deals', arguments: {} })).resolves.toEqual({
      isOk: true,
      value: {
        handle: `handle(${FLEET_ID}:${MESSAGE_ID})`,
        createdAt: NOW,
        updatedAt: new Date('2026-10-19T12:00:00.250Z'),
        state: 'completed',
        answer: { contentType: RESULT_TYPE, payload: '{"content":[]}' },
      },
    });
    expect(sleeps).toEqual([WAIT_POLL_MS]);
  });

  it('is answered the handle once the wait passed without the answer, waiting no longer than the wait', async () => {
    const called = await callToolWaiting(1000)(CALLER, { name: 'a9cr2__list_deals', arguments: {} });

    expect(called).toMatchObject({ isOk: true, value: { state: 'submitted' } });
    expect(sleeps).toEqual([250, 250, 250, 250]);
  });

  it('sleeps no further than the end of the wait', async () => {
    await callToolWaiting(600)(CALLER, { name: 'a9cr2__list_deals', arguments: {} });

    expect(sleeps).toEqual([250, 250, 100]);
  });

  it('is answered working when only a status came within the wait', async () => {
    whileWaiting = () => calls.addReply({ fleetId: FLEET_ID, messageId: MESSAGE_ID }, aCallReply({ contentType: 'text/plain', payload: 'Looking.', receivedAt: now }));

    await expect(callToolWaiting(500)(CALLER, { name: 'a9cr2__list_deals', arguments: {} })).resolves.toMatchObject({ isOk: true, value: { state: 'working' } });
  });

  it('waits not at all with no wait', async () => {
    await callToolWaiting(0)(CALLER, { name: 'a9cr2__list_deals', arguments: {} });

    expect(sleeps).toEqual([]);
  });
});
