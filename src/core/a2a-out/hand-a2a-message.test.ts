import type { DeliveryId, MessageId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  aMovingClock,
  aStatus,
  anAgentParty,
  anArtifact,
  anArtifactChunk,
  fakeA2aAgents,
  fakeAgentShipCrew,
  memoryAgentCalls,
  plainAgentKeys,
  plainGatewayStatuses,
  type ScriptedStream,
} from '../../../test/support/a2a-agent-fakes.js';
import { fakeShipReads, FLEET_ID, memoryConnectionStore, SHIP_ID } from '../../../test/support/fleet-fakes.js';
import { CALLER_SHIP_ID, aPushedDelivery } from '../../../test/support/mcp-out-fakes.js';
import { memoryPartyStore, memoryScopeRequirements } from '../../../test/support/party-fakes.js';
import { createCheckRequiredScopes } from '../parties/check-required-scopes.js';
import type { PushedDelivery } from '../mcp-out/hand-call.js';
import type { AgentEndpoint } from './agent-endpoint.js';
import type { AgentEvent } from './agent-event.js';
import { createFollowAgentTask } from './follow-agent-task.js';
import { createHandA2aMessage } from './hand-a2a-message.js';
import type { SendOutcome, TaskRead } from './ports.js';

const POLL_MS = 2_000;
const DEADLINE_MS = 60_000;
/** More waits than any follow in these tests takes: one that goes on waiting never ends. */
const RUNAWAY_SLEEPS = 1_000;
const POLLED: AgentEndpoint = { url: 'https://agent.supplier.example/a2a', protocolBinding: 'JSONRPC', isStreaming: false };
const STREAMED: AgentEndpoint = { ...POLLED, isStreaming: true };
const MESSAGE: MessageId = 'msg_01m3tbfspe96yf1rnr4ank9m01';
const DELIVERY: DeliveryId = 'dlv_01m3tbfspe96yf1rnr4ank9d01';

const aQuote = (overrides: Partial<PushedDelivery> = {}) => aPushedDelivery({ contentType: 'text/plain', payload: 'Quote 10 bolts', ...overrides });
const taken = (events: AgentEvent[]): SendOutcome => ({ kind: 'task', taskId: 'task-1', contextId: 'ctx-1', events });
const readAs = (...events: ReturnType<typeof aStatus>[]): TaskRead => ({ kind: 'read', events });

let crew: ReturnType<typeof fakeAgentShipCrew>;
let calls: ReturnType<typeof memoryAgentCalls>;
let parties: ReturnType<typeof memoryPartyStore>;
let requirements: ReturnType<typeof memoryScopeRequirements>;
let ships: ReturnType<typeof fakeShipReads>;
let connections: ReturnType<typeof memoryConnectionStore>;
let clock: ReturnType<typeof aMovingClock>;
let slept: number[];
/** What stops the gateway's follow, as a restart does. */
let stop: AbortController;

beforeEach(async () => {
  crew = fakeAgentShipCrew();
  calls = memoryAgentCalls();
  parties = memoryPartyStore();
  await parties.save(anAgentParty());
  requirements = memoryScopeRequirements();
  ships = fakeShipReads();
  ships.state.ships.set(CALLER_SHIP_ID, { name: 'buyer', scopes: ['messages:send', 'supplier:quote'] });
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: new Date('2026-10-25T09:00:00.000Z') });
  clock = aMovingClock();
  slept = [];
  stop = new AbortController();
});

function handWith(agents: ReturnType<typeof fakeA2aAgents>, endpoint = POLLED) {
  const sleep = (ms: number) => {
    if (slept.length > RUNAWAY_SLEEPS) {
      stop.abort();
    }
    slept.push(ms);
    clock.advance(ms);
    return Promise.resolve();
  };
  const follow = createFollowAgentTask({ crew, agents, calls, keys: plainAgentKeys, statuses: plainGatewayStatuses, clock, sleep, pollMs: POLL_MS, deadlineMs: DEADLINE_MS });
  const checkScopes = createCheckRequiredScopes({ connections, door: ships.door });
  const hand = createHandA2aMessage({ crew, agents, calls, keys: plainAgentKeys, statuses: plainGatewayStatuses, parties, requirements, checkScopes, follow, clock, deadlineMs: DEADLINE_MS });
  return (delivery: PushedDelivery = aQuote()) => hand({ party: anAgentParty(), endpoint, delivery, signal: stop.signal });
}

/** What the crew did, by call, the replies by their content. */
const steps = () => crew.log.map((call) => (call[0] === 'send' ? `send ${call[1].contentType} ${call[1].payload}` : call[0]));

describe('the gateway refuses a message from a ship that lacks a scope the agent needs (gateway scopes 4.2)', () => {
  const requireOfAgent = (scopes: string[]) => requirements.change({ fleetId: FLEET_ID, name: anAgentParty().name }, { version: 0, party: scopes, tools: new Map() });

  it('replies to the sender naming what is missing, reports it handled, and never reaches the agent', async () => {
    await requireOfAgent(['supplier:order']);
    const agents = fakeA2aAgents({ sends: [taken([aStatus('completed')])] });

    await expect(handWith(agents)()).resolves.toEqual({ kind: 'handled' });

    expect(agents.sent).toEqual([]);
    expect(steps()).toEqual([`send text/plain ${anAgentParty().name} needs supplier:order, which buyer does not hold`, 'ack', 'handled']);
  });

  it('sends the message for a ship holding every scope the agent needs', async () => {
    await requireOfAgent(['supplier:quote']);
    const agents = fakeA2aAgents({ sends: [taken([aStatus('completed')])] });

    await handWith(agents)();

    expect(agents.sent).toHaveLength(1);
  });

  it('refuses a message whose scope was revoked while it waited: the check is at hand-over', async () => {
    await requireOfAgent(['supplier:quote']);
    ships.state.ships.set(CALLER_SHIP_ID, { name: 'buyer', scopes: ['messages:send'] });
    const agents = fakeA2aAgents({ sends: [taken([aStatus('completed')])] });

    await handWith(agents)();

    expect(agents.sent).toEqual([]);
  });

  it('hands nothing and tries again when core does not answer the scope read: never sent unchecked', async () => {
    await requireOfAgent(['supplier:quote']);
    ships.state.isAnswering = false;
    const agents = fakeA2aAgents({ sends: [taken([aStatus('completed')])] });

    await expect(handWith(agents)()).resolves.toEqual({ kind: 'again' });

    expect({ sent: agents.sent, crew: crew.log }).toEqual({ sent: [], crew: [] });
  });
});

describe('the gateway hands a message to an outside A2A agent (slice 6, flow 4.2)', () => {
  it('hands it with the next number on channel a2a, then sends it at the endpoint, with the vault credential, under a messageId stable for the message', async () => {
    const agents = fakeA2aAgents({ sends: [taken([aStatus('completed')])] });

    await handWith(agents)();

    expect(crew.log[0]).toEqual(['handed', { deliveryId: DELIVERY, handOverNumber: 1, channel: 'a2a' }]);
    expect(agents.sent).toEqual([
      {
        connection: { endpoint: POLLED, credential: { kind: 'bearer', token: 'tok-1' } },
        message: { messageId: `out:${MESSAGE}`, taskId: null, contextId: null, content: { kind: 'parts', parts: [{ kind: 'text', text: 'Quote 10 bolts', mediaType: 'text/plain' }] } },
      },
    ]);
  });

  it('acknowledges only once the agent took it, replies each event to the sender, and is handled at a terminal state', async () => {
    const agents = fakeA2aAgents({ sends: [taken([anArtifact('4 EUR'), aStatus('completed')])] });

    await expect(handWith(agents)()).resolves.toEqual({ kind: 'handled' });

    expect(steps()).toEqual(['handed', 'ack', 'send text/plain 4 EUR', `send application/a2a+json ${aStatus('completed').json}`, 'handled']);
    expect(crew.replies().every((reply) => reply.to === CALLER_SHIP_ID && reply.inReplyTo === MESSAGE)).toBe(true);
  });

  it('follows a task by GetTask every poll when the card states no streaming, replying each event once', async () => {
    const agents = fakeA2aAgents({ sends: [taken([aStatus('working')])], reads: [readAs(aStatus('working')), readAs(aStatus('working'), anArtifact('4 EUR')), readAs(anArtifact('4 EUR'), aStatus('completed'))] });

    await expect(handWith(agents)()).resolves.toEqual({ kind: 'handled' });

    expect(steps()).toEqual(['handed', 'ack', `send application/a2a+json ${aStatus('working').json}`, 'send text/plain 4 EUR', `send application/a2a+json ${aStatus('completed').json}`, 'handled']);
    expect({ read: agents.read, slept }).toEqual({ read: ['task-1', 'task-1', 'task-1'], slept: [POLL_MS, POLL_MS] });
  });

  it('follows a task by SubscribeToTask when the card states streaming', async () => {
    const agents = fakeA2aAgents({ sends: [taken([aStatus('submitted')])], streams: [{ events: [aStatus('working'), anArtifact('4 EUR'), aStatus('completed')], end: { kind: 'closed' } }] });

    await expect(handWith(agents, STREAMED)()).resolves.toEqual({ kind: 'handled' });

    expect(steps().slice(2)).toEqual([`send application/a2a+json ${aStatus('submitted').json}`, `send application/a2a+json ${aStatus('working').json}`, 'send text/plain 4 EUR', `send application/a2a+json ${aStatus('completed').json}`, 'handled']);
    expect(agents.read).toEqual([]);
  });

  it('subscribes again when a stream breaks, and replies no event twice though the agent sends it again', async () => {
    const streams: ScriptedStream[] = [
      { events: [aStatus('working'), anArtifact('4 EUR')], end: { kind: 'broken', reason: 'socket hang up' } },
      { events: [aStatus('working'), anArtifact('4 EUR'), aStatus('completed')], end: { kind: 'closed' } },
    ];
    const agents = fakeA2aAgents({ sends: [taken([])], streams });

    await expect(handWith(agents, STREAMED)()).resolves.toEqual({ kind: 'handled' });

    expect(steps().slice(2)).toEqual([`send application/a2a+json ${aStatus('working').json}`, 'send text/plain 4 EUR', `send application/a2a+json ${aStatus('completed').json}`, 'handled']);
    expect(agents.subscribed).toEqual(['task-1', 'task-1']);
  });

  it('replies each chunk of an artifact once, and not again inside the whole artifact a resubscribe sends', async () => {
    const streams: ScriptedStream[] = [
      { events: [anArtifactChunk({ artifactId: 'a-1', text: '4 ', isAppended: false }), anArtifactChunk({ artifactId: 'a-1', text: 'EUR', isAppended: true })], end: { kind: 'broken', reason: 'socket hang up' } },
      { events: [anArtifactChunk({ artifactId: 'a-1', text: '4 EUR', isAppended: false }), aStatus('completed')], end: { kind: 'closed' } },
    ];
    const agents = fakeA2aAgents({ sends: [taken([])], streams });

    await expect(handWith(agents, STREAMED)()).resolves.toEqual({ kind: 'handled' });

    expect(crew.replies().map(({ payload }) => payload.slice(0, 20))).toEqual(['4 ', 'EUR', aStatus('completed').json.slice(0, 20)]);
  });

  it('replies each chunk of an artifact once across a restart in its middle, the later chunks in their places, and its end once', async () => {
    const before = fakeA2aAgents({ sends: [taken([])], streams: [{ events: [anArtifactChunk({ artifactId: 'a-1', text: '4 ', isAppended: false }), anArtifactChunk({ artifactId: 'a-1', text: 'EUR', isAppended: true }), aStatus('working')], end: { kind: 'closed' } }] });
    const send = crew.send.bind(crew);
    crew.send = async (crewToken, message) => {
      const sent = await send(crewToken, message);
      if (crew.replies().length === 2) {
        stop.abort();
      }
      return sent;
    };
    await expect(handWith(before, STREAMED)()).resolves.toEqual({ kind: 'again' });
    stop = new AbortController();
    const after = fakeA2aAgents({
      streams: [{ events: [anArtifactChunk({ artifactId: 'a-1', text: '4 EUR', isAppended: false }), anArtifactChunk({ artifactId: 'a-1', text: ' incl. VAT', isAppended: true }), aStatus('completed')], end: { kind: 'closed' } }],
    });

    await expect(handWith(after, STREAMED)(aQuote({ state: 'handed', handOverNumber: 1 }))).resolves.toEqual({ kind: 'handled' });

    expect(crew.replies().map(({ payload }) => payload)).toEqual(['4 ', 'EUR', ' incl. VAT', aStatus('completed').json]);
  });

  it('counts a reply the fleet refuses under a key the follow derived as replied, and goes on to the end', async () => {
    await crew.send('aeolus_ct_v1_proxy', { to: CALLER_SHIP_ID, inReplyTo: MESSAGE, contentType: 'text/plain', payload: 'an earlier reply', idempotencyKey: plainAgentKeys.replyKeyOf(FLEET_ID, { taskId: 'task-1', event: JSON.stringify(['artifact', 'a-1', 0]) }) });
    const agents = fakeA2aAgents({ sends: [taken([anArtifactChunk({ artifactId: 'a-1', text: '4 EUR', isAppended: false }), aStatus('completed')])] });

    await expect(handWith(agents)()).resolves.toEqual({ kind: 'handled' });

    expect({ replies: crew.replies().map(({ payload }) => payload), slept }).toEqual({ replies: ['an earlier reply', aStatus('completed').json], slept: [] });
  });

  it('stops sending a reply the fleet does not take at the deadline', async () => {
    const agents = fakeA2aAgents({ sends: [taken([aStatus('working')])] });
    crew.state.isSendAnswering = false;

    await expect(handWith(agents)()).resolves.toEqual({ kind: 'again' });

    expect(clock.now().getTime() - new Date('2026-10-23T12:00:00.000Z').getTime()).toBeLessThanOrEqual(DEADLINE_MS + POLL_MS);
  });

  it('replies a status again on a follow-up of the same task, though the agent tells it as before', async () => {
    const agents = fakeA2aAgents({ sends: [taken([aStatus('working'), aStatus('inputRequired')]), taken([aStatus('working'), aStatus('completed')])] });
    const hand = handWith(agents);
    await hand();
    const [, asked] = crew.replies();
    const followUp: MessageId = 'msg_01m3tbfspe96yf1rnr4ank9m02';

    await hand(aQuote({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9d02', messageId: followUp, payload: 'Yes, M8', inReplyTo: await replyMessageIdOf(asked?.idempotencyKey) }));

    expect(crew.replies().filter(({ inReplyTo }) => inReplyTo === followUp).map(({ payload }) => payload)).toEqual([aStatus('working').json, aStatus('completed').json]);
  });

  it('reads the task once when the stream breaks, so a task that ended meanwhile replies its artifact and end, nothing failed', async () => {
    const streams: ScriptedStream[] = [{ events: [aStatus('working')], end: { kind: 'broken', reason: 'socket hang up' } }];
    const agents = fakeA2aAgents({ sends: [taken([])], streams, reads: [readAs(anArtifact('4 EUR'), aStatus('completed'))] });

    await expect(handWith(agents, STREAMED)()).resolves.toEqual({ kind: 'handled' });

    expect(steps().slice(2)).toEqual([`send application/a2a+json ${aStatus('working').json}`, 'send text/plain 4 EUR', `send application/a2a+json ${aStatus('completed').json}`, 'handled']);
    expect({ subscribed: agents.subscribed, read: agents.read }).toEqual({ subscribed: ['task-1'], read: ['task-1'] });
  });

  it('reads the task once when the agent refuses a stream of a task that ended, as after a restart, and adds no failed to its end', async () => {
    await calls.save({ deliveryId: DELIVERY, fleetId: FLEET_ID, party: 'supplier', messageId: MESSAGE, senderShipId: CALLER_SHIP_ID, state: 'following', taskId: 'task-1', contextId: 'ctx-1', deadlineAt: new Date(clock.now().getTime() + DEADLINE_MS), answer: null, replied: [], chunkPlaces: {} });
    const agents = fakeA2aAgents({ streams: [{ events: [], end: { kind: 'refused', reason: 'Task task-1 is in a terminal state' } }], reads: [readAs(aStatus('completed'))] });

    await expect(handWith(agents, STREAMED)(aQuote({ state: 'handed', handOverNumber: 1 }))).resolves.toEqual({ kind: 'handled' });

    expect(steps().filter((step) => step !== 'ack')).toEqual([`send application/a2a+json ${aStatus('completed').json}`, 'handled']);
    expect(slept).toEqual([]);
  });

  it("ends the follow at once with failed and the agent's reason when it refuses reading the task", async () => {
    const agents = fakeA2aAgents({ sends: [taken([aStatus('working')])], reads: [{ kind: 'refused', reason: 'The agent answered 403: forbidden' }] });

    await expect(handWith(agents)()).resolves.toEqual({ kind: 'handled' });

    expect(JSON.parse(crew.replies().at(-1)?.payload ?? '{}')).toMatchObject({ statusUpdate: { status: { state: 'failed', reason: "The agent refused following its task: The agent answered 403: forbidden" } } });
    expect(slept).toEqual([]);
  });

  it("ends the follow at once with failed and the agent's reason when it refuses a stream of a task still going", async () => {
    const agents = fakeA2aAgents({ sends: [taken([])], streams: [{ events: [], end: { kind: 'refused', reason: 'The agent answered 401: bad token' } }], reads: [readAs(aStatus('working'))] });

    await expect(handWith(agents, STREAMED)()).resolves.toEqual({ kind: 'handled' });

    expect(JSON.parse(crew.replies().at(-1)?.payload ?? '{}')).toMatchObject({ statusUpdate: { status: { state: 'failed', reason: 'The agent refused following its task: The agent answered 401: bad token' } } });
    expect({ subscribed: agents.subscribed, slept }).toEqual({ subscribed: ['task-1'], slept: [] });
  });

  it('replies failed and is handled once the deadline passes with no terminal state', async () => {
    const agents = fakeA2aAgents({ sends: [taken([aStatus('working')])], reads: [readAs(aStatus('working'))] });

    await expect(handWith(agents)()).resolves.toEqual({ kind: 'handled' });

    const last = crew.replies().at(-1);
    expect(last).toMatchObject({ contentType: 'application/a2a+json' });
    expect(JSON.parse(last?.payload ?? '{}')).toEqual({ statusUpdate: { taskId: 'task-1', status: { state: 'failed', reason: 'The agent did not end its task within 60000 ms' } } });
    expect(steps().at(-1)).toBe('handled');
  });

  it('replies failed at the deadline of a stream that hangs', async () => {
    const agents = fakeA2aAgents({ sends: [taken([aStatus('working')])], streams: ['hangs'] }, clock);

    await expect(handWith(agents, STREAMED)()).resolves.toEqual({ kind: 'handled' });

    expect(crew.replies().at(-1)?.payload).toContain('did not end its task');
  });

  it.each(['inputRequired', 'authRequired'] as const)('replies %s and is handled, the task kept for the answer', async (state) => {
    const agents = fakeA2aAgents({ sends: [taken([aStatus(state)])] });

    await expect(handWith(agents)()).resolves.toEqual({ kind: 'handled' });

    expect(steps()).toEqual(['handed', 'ack', `send application/a2a+json ${aStatus(state).json}`, 'handled']);
    expect([...calls.replies.values()]).toEqual([{ taskId: 'task-1', contextId: 'ctx-1' }]);
  });

  it("sends the sender's answer to an input-required reply as SendMessage with the same task and context", async () => {
    const agents = fakeA2aAgents({ sends: [taken([aStatus('inputRequired')]), taken([aStatus('completed')])] });
    const hand = handWith(agents);
    await hand();
    const [asked] = crew.replies();

    const answered = await hand(aQuote({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9d02', messageId: 'msg_01m3tbfspe96yf1rnr4ank9m02', payload: 'Yes, M8', inReplyTo: await replyMessageIdOf(asked?.idempotencyKey) }));

    expect(answered).toEqual({ kind: 'handled' });
    expect(agents.sent[1]?.message).toMatchObject({ messageId: 'out:msg_01m3tbfspe96yf1rnr4ank9m02', taskId: 'task-1', contextId: 'ctx-1' });
  });

  it('replies a message answer with no task once, before acknowledging, so a lost acknowledgement sends no second reply, and follows nothing', async () => {
    const agents = fakeA2aAgents({ sends: [{ kind: 'message', event: { kind: 'message', messageId: 'm-1', parts: [{ kind: 'text', text: 'We sell no bolts', mediaType: 'text/plain' }], json: '{}' } }] });

    await expect(handWith(agents)()).resolves.toEqual({ kind: 'handled' });

    expect(steps()).toEqual(['handed', 'send text/plain We sell no bolts', 'ack', 'handled']);
    expect(agents.read).toEqual([]);
  });

  it("replies rejected with the agent's reason to a message the agent refused, then acknowledges and handles it", async () => {
    const agents = fakeA2aAgents({ sends: [{ kind: 'refused', reason: 'The agent answered 401: bad token' }] });

    await expect(handWith(agents)()).resolves.toEqual({ kind: 'handled' });

    expect(steps().map((step) => step.split(' {')[0])).toEqual(['handed', 'send application/a2a+json', 'ack', 'handled']);
    expect(JSON.parse(crew.replies()[0]?.payload ?? '{}')).toMatchObject({ statusUpdate: { status: { state: 'rejected', reason: 'The agent answered 401: bad token' } } });
  });

  it.each<[string, SendOutcome]>([
    ['a message answer', { kind: 'message', event: { kind: 'message', messageId: 'm-1', parts: [{ kind: 'text', text: 'We sell no bolts', mediaType: 'text/plain' }], json: '{}' } }],
    ['a refusal', { kind: 'refused', reason: 'The agent answered 400: no part list' }],
  ])('keeps %s of an agent marked not repeatable before acknowledging, so it is handled when it comes again after a lost acknowledgement, replied once', async (_kind, answer) => {
    await parties.save(anAgentParty({ isRepeatable: false }));
    const agents = fakeA2aAgents({ sends: [answer] });
    const hand = handWith(agents);
    crew.state.isAckAnswering = false;
    await expect(hand()).resolves.toEqual({ kind: 'again' });
    crew.state.isAckAnswering = true;

    await expect(hand(aQuote({ state: 'handed', handOverNumber: 1 }))).resolves.toEqual({ kind: 'handled' });

    expect({ sent: agents.sent.length, replies: crew.replies().length, steps: steps().map((step) => step.split(' ')[0]) }).toEqual({ sent: 1, replies: 1, steps: ['handed', 'send', 'ack', 'handled'] });
  });

  it('hands a message with no answer again when the agent is repeatable, the same messageId the next time', async () => {
    const agents = fakeA2aAgents({ sends: [{ kind: 'unanswered', reason: 'The agent answered 503' }, taken([aStatus('completed')])] });
    const hand = handWith(agents);

    await expect(hand()).resolves.toEqual({ kind: 'again' });
    await expect(hand(aQuote({ state: 'handed', handOverNumber: 1 }))).resolves.toEqual({ kind: 'handled' });

    expect(steps().filter((step) => step === 'handed' || step === 'ack')).toEqual(['handed', 'handed', 'ack']);
    expect(crew.log[1]).toMatchObject(['handed', { handOverNumber: 2 }]);
    expect(agents.sent.map(({ message }) => message.messageId)).toEqual([`out:${MESSAGE}`, `out:${MESSAGE}`]);
  });

  it('reports a message with no answer not handled when the agent is marked not repeatable (A9), and never sends it again', async () => {
    await parties.save(anAgentParty({ isRepeatable: false }));
    const agents = fakeA2aAgents({ sends: [{ kind: 'unanswered', reason: 'timeout' }] });
    const hand = handWith(agents);

    await expect(hand()).resolves.toEqual({ kind: 'notHandled' });
    await expect(hand(aQuote({ state: 'handed', handOverNumber: 1 }))).resolves.toEqual({ kind: 'notHandled' });

    expect(crew.log.filter((call) => call[0] === 'notHandled')).toEqual([
      ['notHandled', { deliveryId: DELIVERY, reason: 'The call may have run; its answer was lost. Check the outside system, then resend or dismiss.' }],
      ['notHandled', { deliveryId: DELIVERY, reason: 'The call may have run; its answer was lost. Check the outside system, then resend or dismiss.' }],
    ]);
    expect(agents.sent).toHaveLength(1);
  });

  it('reports a message handed before with no answer kept not handled when the agent is not repeatable, sending nothing', async () => {
    await parties.save(anAgentParty({ isRepeatable: false }));
    const agents = fakeA2aAgents({ sends: [taken([aStatus('completed')])] });

    await expect(handWith(agents)(aQuote({ state: 'handed', handOverNumber: 1 }))).resolves.toEqual({ kind: 'notHandled' });
    expect(agents.sent).toEqual([]);
  });

  it('hands a message that never reached the agent again, even when it is not repeatable', async () => {
    await parties.save(anAgentParty({ isRepeatable: false }));
    const agents = fakeA2aAgents({ sends: [{ kind: 'notSent', reason: 'The issuer refused the client credentials' }, taken([aStatus('completed')])] });
    const hand = handWith(agents);

    await expect(hand()).resolves.toEqual({ kind: 'again' });
    await expect(hand(aQuote({ state: 'handed', handOverNumber: 1 }))).resolves.toEqual({ kind: 'handled' });
  });

  it('reports the delivery not handled when the task is gone while followed', async () => {
    const agents = fakeA2aAgents({ sends: [taken([aStatus('working')])], reads: [{ kind: 'gone', reason: 'TaskNotFoundError' }] });

    await expect(handWith(agents)()).resolves.toEqual({ kind: 'notHandled' });

    expect(crew.log.at(-1)).toEqual(['notHandled', { deliveryId: DELIVERY, reason: "The agent's task is gone: TaskNotFoundError" }]);
  });

  it('replies why a payload is no message, and is handled with nothing sent', async () => {
    const agents = fakeA2aAgents();

    await expect(handWith(agents)(aQuote({ contentType: 'application/json', payload: '{bolts' }))).resolves.toEqual({ kind: 'handled' });

    expect(steps()).toEqual(['send text/plain A application/json payload is JSON', 'ack', 'handled']);
    expect(agents.sent).toEqual([]);
  });

  it('sends nothing on the fifth attempt', async () => {
    crew.state.handedState = 'undeliverable';
    const agents = fakeA2aAgents();

    await expect(handWith(agents)()).resolves.toEqual({ kind: 'undeliverable' });
    expect(agents.sent).toEqual([]);
  });

  it('hands a delivery whose acknowledgement was lost again, following its task with nothing sent twice', async () => {
    crew.state.isAckAnswering = false;
    const agents = fakeA2aAgents({ sends: [taken([aStatus('working')])], reads: [readAs(aStatus('completed'))] });
    const hand = handWith(agents);
    await expect(hand()).resolves.toEqual({ kind: 'again' });
    crew.state.isAckAnswering = true;

    await expect(hand(aQuote({ state: 'handed', handOverNumber: 1 }))).resolves.toEqual({ kind: 'handled' });

    expect({ sent: agents.sent.length, replies: crew.replies().map(({ payload }) => payload) }).toEqual({ sent: 1, replies: [aStatus('completed').json] });
  });
});

describe('the gateway follows on after a restart (slice 6)', () => {
  it('follows a task it acknowledged before, sending nothing to the agent, until it is handled', async () => {
    const agents = fakeA2aAgents({ reads: [readAs(aStatus('working'), aStatus('completed'))] });
    await calls.save({ deliveryId: DELIVERY, fleetId: FLEET_ID, party: 'supplier', messageId: MESSAGE, senderShipId: CALLER_SHIP_ID, state: 'following', taskId: 'task-1', contextId: 'ctx-1', deadlineAt: new Date(clock.now().getTime() + DEADLINE_MS), answer: null, replied: [], chunkPlaces: {} });
    const sleep = (ms: number) => {
      clock.advance(ms);
      return Promise.resolve();
    };
    const follow = createFollowAgentTask({ crew, agents, calls, keys: plainAgentKeys, statuses: plainGatewayStatuses, clock, sleep, pollMs: POLL_MS, deadlineMs: DEADLINE_MS });

    const [call] = await calls.following({ fleetId: FLEET_ID, party: 'supplier' });

    await expect(call && follow({ party: anAgentParty(), endpoint: POLLED, call, signal: new AbortController().signal })).resolves.toEqual({ kind: 'handled' });

    expect(agents.sent).toEqual([]);
    await expect(calls.find({ fleetId: FLEET_ID, party: 'supplier' }, DELIVERY)).resolves.toMatchObject({ state: 'done' });
  });
});

/** The message id the fleet gave the reply sent under this key, as the sender's answer names it. */
function replyMessageIdOf(idempotencyKey: string | undefined): Promise<MessageId | null> {
  return Promise.resolve(crew.messageIdOf(idempotencyKey ?? '') ?? null);
}
