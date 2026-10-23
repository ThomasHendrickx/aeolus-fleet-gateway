import type { DeliveryId, MessageId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  aMovingClock,
  aStatus,
  anAgentParty,
  anArtifact,
  fakeA2aAgents,
  fakeAgentShipCrew,
  memoryAgentCalls,
  plainAgentKeys,
  plainGatewayStatuses,
  type ScriptedStream,
} from '../../../test/support/a2a-agent-fakes.js';
import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { CALLER_SHIP_ID, aPushedDelivery } from '../../../test/support/mcp-out-fakes.js';
import { memoryPartyStore } from '../../../test/support/party-fakes.js';
import type { PushedDelivery } from '../mcp-out/hand-call.js';
import type { AgentEndpoint } from './agent-endpoint.js';
import type { AgentEvent } from './agent-event.js';
import { createFollowAgentTask } from './follow-agent-task.js';
import { createHandA2aMessage } from './hand-a2a-message.js';
import type { SendOutcome, TaskRead } from './ports.js';

const POLL_MS = 2_000;
const DEADLINE_MS = 60_000;
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
let clock: ReturnType<typeof aMovingClock>;
let slept: number[];

beforeEach(async () => {
  crew = fakeAgentShipCrew();
  calls = memoryAgentCalls();
  parties = memoryPartyStore();
  await parties.save(anAgentParty());
  clock = aMovingClock();
  slept = [];
});

function handWith(agents: ReturnType<typeof fakeA2aAgents>, endpoint = POLLED) {
  const sleep = (ms: number) => {
    slept.push(ms);
    clock.advance(ms);
    return Promise.resolve();
  };
  const follow = createFollowAgentTask({ crew, agents, calls, keys: plainAgentKeys, statuses: plainGatewayStatuses, clock, sleep, pollMs: POLL_MS, deadlineMs: DEADLINE_MS });
  const hand = createHandA2aMessage({ crew, agents, calls, keys: plainAgentKeys, statuses: plainGatewayStatuses, parties, follow, clock, deadlineMs: DEADLINE_MS });
  return (delivery: PushedDelivery = aQuote()) => hand({ party: anAgentParty(), endpoint, delivery, signal: new AbortController().signal });
}

/** What the crew did, by call, the replies by their content. */
const steps = () => crew.log.map((call) => (call[0] === 'send' ? `send ${call[1].contentType} ${call[1].payload}` : call[0]));

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
    const agents = fakeA2aAgents({ sends: [{ kind: 'message', event: { kind: 'message', parts: [{ kind: 'text', text: 'We sell no bolts', mediaType: 'text/plain' }], json: '{}' } }] });

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
    await calls.save({ deliveryId: DELIVERY, fleetId: FLEET_ID, party: 'supplier', messageId: MESSAGE, senderShipId: CALLER_SHIP_ID, state: 'following', taskId: 'task-1', contextId: 'ctx-1', deadlineAt: new Date(clock.now().getTime() + DEADLINE_MS) });
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
async function replyMessageIdOf(idempotencyKey: string | undefined): Promise<MessageId | null> {
  const sent = await crew.send('aeolus_ct_v1_proxy', { to: CALLER_SHIP_ID, contentType: 'text/plain', payload: '', idempotencyKey: idempotencyKey ?? '' });
  return sent.isOk ? sent.value.messageId : null;
}
