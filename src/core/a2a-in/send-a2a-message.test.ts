import { PAYLOAD_MAX_BYTES } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aCallReply, aDiscoveredShip, CRM_SHIP_ID, fakeAliases, fakeCallKeys, fakeCallSender, fakeDiscovery, MESSAGE_ID, memoryClientCalls } from '../../../test/support/mcp-in-fakes.js';
import { PROXY_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import type { Sleep } from '../mcp-out/run-party.js';
import type { Clock } from '../shared/clock.js';
import { createFindReachedShip } from './find-reached-ship.js';
import type { InboundMessage } from './inbound-message.js';
import { createListReachedShips } from './list-reached-ships.js';
import { createSendA2aMessage } from './send-a2a-message.js';

const CALLER = { fleetId: FLEET_ID, party: 'supplier' };
const CRM_ALIAS = `a${CRM_SHIP_ID.slice(-4)}`;
const NOW = new Date('2026-10-23T12:00:00.000Z');
const WAIT_POLL_MS = 250;
const TASK_ID = `handle(${FLEET_ID}:${MESSAGE_ID})`;

let now: Date;
const clock: Clock = { now: () => now };
/** What happens in the fleet while the call waits, before each sleep ends. */
let whileWaiting: () => Promise<void>;
const sleep: Sleep = async (ms) => {
  now = new Date(now.getTime() + ms);
  await whileWaiting();
};

let discovery: ReturnType<typeof fakeDiscovery>;
let sender: ReturnType<typeof fakeCallSender>;
let calls: ReturnType<typeof memoryClientCalls>;
let send: ReturnType<typeof createSendA2aMessage>;

/** The CRM ship, stating one capability that takes plain text, with the wait and deadline given. */
function aCrmStating(timing: { waitMs?: number; deadlineMs?: number } = {}) {
  return aDiscoveredShip({ statement: { by: 'crew', summary: 'The CRM.', capabilities: [{ name: 'quote', inputModes: ['text/plain'], outputModes: ['text/plain'], ...timing }] } });
}

function aMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return { messageId: 'm-1', parts: [{ kind: 'text', text: 'Quote 40 chairs.' }], asJson: '{"messageId":"m-1"}', ...overrides };
}

beforeEach(async () => {
  const parties = memoryPartyStore();
  await parties.save({ fleetId: FLEET_ID, name: 'supplier', kind: 'a2aClient', bearerHash: 'h(b)', state: 'crewed', proxyShipId: PROXY_SHIP_ID, secret: null, crewToken: 'aeolus_ct_v1_supplier', requestId: 'r-1', requestHash: 'h', approvedAt: NOW });
  discovery = fakeDiscovery([aCrmStating()]);
  sender = fakeCallSender();
  calls = memoryClientCalls();
  now = NOW;
  whileWaiting = () => Promise.resolve();
  send = createSendA2aMessage({
    parties,
    findReachedShip: createFindReachedShip({ listReachedShips: createListReachedShips({ parties, discovery, aliases: fakeAliases }) }),
    sender,
    calls,
    keys: fakeCallKeys(),
    clock,
    sleep,
    waitMaxMs: 30_000,
    waitPollMs: WAIT_POLL_MS,
  });
});

const sending = (message: InboundMessage = aMessage(), isBlocking = true) => send({ caller: CALLER, alias: CRM_ALIAS, message, isBlocking });

describe("an outside A2A client's message is a message its proxy ship sends (decision 0060)", () => {
  it("sends the message's content to the alias's ship as the proxy ship, keyed by the client's messageId", async () => {
    await sending();

    expect(sender.sent).toEqual([{ crewToken: 'aeolus_ct_v1_supplier', to: CRM_SHIP_ID, contentType: 'text/plain', payload: 'Quote 40 chairs.', idempotencyKey: `key(${FLEET_ID}:supplier:m-1)` }]);
  });

  it("answers the task, its id the HMAC of the message's msg_ id, only once the fleet's send answered OK", async () => {
    await expect(sending()).resolves.toMatchObject({ isOk: true, value: { taskId: TASK_ID, contextId: `context(${FLEET_ID}:${MESSAGE_ID})`, status: { state: 'submitted' } } });
  });

  it("keeps the task and its call, with the capability's output type, deadline and the client's message", async () => {
    discovery.state.ships = [aCrmStating({ deadlineMs: 60_000 })];

    await sending();

    expect({ tasks: calls.tasks.map((task) => task.taskId), call: calls.held[0] }).toMatchObject({
      tasks: [TASK_ID],
      call: { messageId: MESSAGE_ID, handle: TASK_ID, capability: 'quote', outputContentType: 'text/plain', deadlineAt: new Date('2026-10-23T12:01:00.000Z'), task: { taskId: TASK_ID, message: '{"messageId":"m-1"}' } },
    });
  });

  it('sends one message for the same messageId sent again, answering the same task', async () => {
    const [first, again] = [await sending(), await sending()];

    expect({ sent: sender.sent.length, first: first.isOk && first.value.taskId, again: again.isOk && again.value.taskId, calls: calls.held.length }).toEqual({ sent: 1, first: TASK_ID, again: TASK_ID, calls: 1 });
  });

  it('answers no task and keeps nothing when the fleet refuses the send', async () => {
    sender.state.refusal = { code: 'NOT_REACHABLE', message: 'No rule matches' };

    await expect(sending()).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_REACHABLE' } });
    expect({ calls: calls.held.length, tasks: calls.tasks.length }).toEqual({ calls: 0, tasks: 0 });
  });

  it('answers no task and keeps nothing when the fleet does not answer, so the client sends again with the same messageId', async () => {
    sender.state.refusal = { code: 'UNAVAILABLE', message: 'The fleet did not answer' };

    await expect(sending()).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
    expect({ calls: calls.held.length, tasks: calls.tasks.length }).toEqual({ calls: 0, tasks: 0 });
  });

  it('refuses an alias of no ship it reaches, sending nothing', async () => {
    await expect(send({ caller: CALLER, alias: 'azzzzzzz', message: aMessage(), isBlocking: true })).resolves.toMatchObject({ isOk: false, error: { kind: 'UNKNOWN_ALIAS' } });
    expect(sender.sent).toEqual([]);
  });

  it("sends a payload of exactly the fleet's limit, and refuses one byte more, sending nothing", async () => {
    const [atLimit, over] = [await sending(aMessage({ parts: [{ kind: 'text', text: 'x'.repeat(PAYLOAD_MAX_BYTES) }] })), await sending(aMessage({ messageId: 'm-2', parts: [{ kind: 'text', text: 'x'.repeat(PAYLOAD_MAX_BYTES + 1) }] }))];

    expect({ atLimit: atLimit.isOk, over: over.isOk ? undefined : over.error.kind, sent: sender.sent.length }).toEqual({ atLimit: true, over: 'PAYLOAD_TOO_LARGE', sent: 1 });
  });

  it('calls no capability for a content type no first input mode equals: no wait, no deadline, its first reply answers it', async () => {
    discovery.state.ships = [aCrmStating({ waitMs: 10_000, deadlineMs: 60_000 })];

    await sending(aMessage({ parts: [{ kind: 'data', data: { chairs: 40 } }] }));

    expect(calls.held[0]).toMatchObject({ capability: null, outputContentType: null, deadlineAt: null });
    expect(now).toEqual(NOW);
  });
});

describe('a blocking SendMessage waits as the capability states (interop 5.3)', () => {
  it("waits up to the capability's wait for the answer, and answers the completed task", async () => {
    discovery.state.ships = [aCrmStating({ waitMs: 10_000 })];
    whileWaiting = () => calls.addReply({ fleetId: FLEET_ID, messageId: MESSAGE_ID }, aCallReply({ receivedAt: now }));

    await expect(sending()).resolves.toMatchObject({ isOk: true, value: { status: { state: 'completed' } } });
    expect(now).toEqual(new Date(NOW.getTime() + WAIT_POLL_MS));
  });

  it("answers at once when the client set return_immediately, whatever the capability's wait", async () => {
    discovery.state.ships = [aCrmStating({ waitMs: 10_000 })];

    await expect(sending(aMessage(), false)).resolves.toMatchObject({ isOk: true, value: { status: { state: 'submitted' } } });
    expect(now).toEqual(NOW);
  });

  it('answers the task as it stands once the wait passed without an answer', async () => {
    discovery.state.ships = [aCrmStating({ waitMs: 1000 })];

    await expect(sending()).resolves.toMatchObject({ isOk: true, value: { status: { state: 'submitted' } } });
    expect(now).toEqual(new Date(NOW.getTime() + 1000));
  });
});

describe('a message with a taskId continues the task (decision 0060)', () => {
  const continuing = (overrides: Partial<InboundMessage> = {}) => sending(aMessage({ messageId: 'm-2', taskId: TASK_ID, asJson: '{"messageId":"m-2"}', ...overrides }));

  it("sends it in reply to the task's latest reply, and answers the same task in its context", async () => {
    await sending();
    const question = aCallReply({ messageId: 'msg_01m3tbfspe96yf1rnr4ank9q01', contentType: 'application/vnd.aeolus.question+json', payload: '{"id":"q-1"}' });
    await calls.addReply({ fleetId: FLEET_ID, messageId: MESSAGE_ID }, question);

    const continued = await continuing();

    expect({ inReplyTo: sender.sent[1]?.inReplyTo, taskId: continued.isOk && continued.value.taskId, contextId: continued.isOk && continued.value.contextId }).toEqual({
      inReplyTo: 'msg_01m3tbfspe96yf1rnr4ank9q01',
      taskId: TASK_ID,
      contextId: `context(${FLEET_ID}:${MESSAGE_ID})`,
    });
  });

  it("sends it in reply to the task's latest message while no reply came", async () => {
    await sending();

    await continuing();

    expect(sender.sent[1]?.inReplyTo).toBe(MESSAGE_ID);
  });

  it('refuses a task of no call of this client, sending nothing', async () => {
    await expect(continuing()).resolves.toMatchObject({ isOk: false, error: { kind: 'TASK_NOT_FOUND' } });
    expect(sender.sent).toEqual([]);
  });

  it('refuses a task in a terminal state', async () => {
    await sending();
    await calls.addReply({ fleetId: FLEET_ID, messageId: MESSAGE_ID }, aCallReply());

    await expect(continuing()).resolves.toMatchObject({ isOk: false, error: { kind: 'TASK_TERMINAL' } });
  });

  it("refuses a contextId other than the task's", async () => {
    await sending();

    await expect(continuing({ contextId: 'ctx-other' })).resolves.toMatchObject({ isOk: false, error: { kind: 'CONTEXT_MISMATCH' } });
  });

  it("refuses a task of another ship than the alias's", async () => {
    await sending();
    discovery.state.ships = [aCrmStating(), aDiscoveredShip({ shipId: 'shp_01m3tbfspe96yf1rnr4ank9led' })];

    await expect(send({ caller: CALLER, alias: 'a9led', message: aMessage({ messageId: 'm-2', taskId: TASK_ID }), isBlocking: true })).resolves.toMatchObject({ isOk: false, error: { kind: 'TASK_NOT_FOUND' } });
  });
});
