/**
 * Stand-ins for A2A out (slice 5): an outside agent's card, and the cards
 * the gateway reads, by address, as told.
 */
import type { DeliveryId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { AgentEvent, AgentState } from '../../src/core/a2a-out/agent-event.js';
import type { OutboundMessage } from '../../src/core/a2a-out/agent-message.js';
import type {
  A2aAgents,
  AgentCall,
  AgentCalls,
  AgentCard,
  AgentCards,
  AgentConnection,
  AgentKeys,
  AgentShipCrew,
  CardFailure,
  GatewayStatuses,
  SendOutcome,
  SubscriptionEnd,
  TaskRead,
} from '../../src/core/a2a-out/ports.js';
import type { A2aAgentParty } from '../../src/core/parties/party.js';
import { err, ok, type Result } from '../../src/core/shared/result.js';
import { FLEET_ID } from './fleet-fakes.js';
import { PROXY_SHIP_ID } from './party-fakes.js';

export const CARD_URL = 'https://agent.supplier.example/.well-known/agent-card.json';

export function anAgentCard(change: Partial<AgentCard> = {}): AgentCard {
  return {
    name: 'Supplier agent',
    description: 'Quotes and books parts.',
    supportedInterfaces: [{ url: 'https://agent.supplier.example/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['application/json'],
    isStreaming: false,
    skills: [{ id: 'quote', name: 'Quote a price', description: 'Answers a price for a part list.', inputModes: [], outputModes: [] }],
    ...change,
  };
}

/** Cards answered by address, each read kept; an address not told answers unreachable. */
export function fakeAgentCards(cards: Record<string, Result<AgentCard, CardFailure>>): AgentCards & { read: AgentCards['read']; reads: string[]; cards: Record<string, Result<AgentCard, CardFailure>> } {
  const reads: string[] = [];
  return {
    reads,
    cards,
    read: (cardUrl) => {
      reads.push(cardUrl);
      return Promise.resolve(cards[cardUrl] ?? err({ kind: 'UNREACHABLE', reason: 'nothing answers' }));
    },
  };
}

export const answeredCard = (card: AgentCard = anAgentCard()) => ok(card);

/** A crewed outside A2A agent party, repeatable, as an approver added it. */
export function anAgentParty(change: Partial<A2aAgentParty> = {}): A2aAgentParty {
  return {
    fleetId: FLEET_ID,
    name: 'supplier',
    kind: 'a2aAgent',
    cardUrl: CARD_URL,
    credential: { kind: 'bearer', token: 'tok-1' },
    concurrencyLimit: 4,
    isRepeatable: true,
    state: 'crewed',
    proxyShipId: PROXY_SHIP_ID,
    secret: null,
    crewToken: 'aeolus_ct_v1_proxy',
    requestId: 'r-1',
    requestHash: 'h',
    approvedAt: new Date('2026-10-23T10:00:00.000Z'),
    ...change,
  };
}

/** An A2A status event as the agent tells it, naming its state in its JSON. */
export const aStatus = (state: AgentState, taskId = 'task-1'): AgentEvent => ({ kind: 'status', state, json: JSON.stringify({ statusUpdate: { taskId, status: { state } } }) });

/** An A2A artifact event of one text part. */
export const anArtifact = (text: string, taskId = 'task-1'): AgentEvent => ({ kind: 'artifact', parts: [{ kind: 'text', text, mediaType: 'text/plain' }], json: JSON.stringify({ artifactUpdate: { taskId, artifact: { parts: [{ text }] } } }) });

/** One SubscribeToTask stream as the agent sends it: its events, then how it ends; or a stream that hangs until aborted. */
export type ScriptedStream = { events: AgentEvent[]; end: SubscriptionEnd } | 'hangs';

/** A clock that moves only when told: by a sleep, or by a stream that hangs until its timeout. */
export function aMovingClock(start = new Date('2026-10-23T12:00:00.000Z')) {
  let now = start.getTime();
  return {
    now: () => new Date(now),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** Outside agents answering as told: SendMessage each in turn, GetTask each in turn, each stream in turn; the last again once they ran out. A stream that hangs ends broken at its timeout, the clock moved by it. */
export function fakeA2aAgents(script: { sends?: SendOutcome[]; reads?: TaskRead[]; streams?: ScriptedStream[] } = {}, clock?: ReturnType<typeof aMovingClock>) {
  const sent: { connection: AgentConnection; message: OutboundMessage }[] = [];
  const read: string[] = [];
  const subscribed: string[] = [];
  const at = <T>(list: T[], index: number): T | undefined => list[Math.min(index, list.length - 1)];
  const agents: A2aAgents & { sent: typeof sent; read: string[]; subscribed: string[]; script: typeof script } = {
    sent,
    read,
    subscribed,
    script,
    send: (connection, message) => {
      sent.push({ connection, message });
      return Promise.resolve(at(script.sends ?? [], sent.length - 1) ?? { kind: 'unanswered', reason: 'no answer' });
    },
    getTask: (_connection, taskId) => {
      read.push(taskId);
      return Promise.resolve(at(script.reads ?? [], read.length - 1) ?? { kind: 'unanswered', reason: 'no answer' });
    },
    subscribe: async (_connection, { taskId, timeoutMs, signal, onEvent }) => {
      subscribed.push(taskId);
      const stream = at(script.streams ?? [], subscribed.length - 1) ?? { events: [], end: { kind: 'broken', reason: 'no stream' } };
      if (stream === 'hangs') {
        clock?.advance(timeoutMs);
        return { kind: 'broken', reason: `no event within ${String(timeoutMs)} ms` };
      }
      for (const event of stream.events) {
        if (signal.aborted) {
          return { kind: 'closed' };
        }
        await onEvent(event);
      }
      return stream.end;
    },
  };
  return agents;
}

type AgentCrewCall = ['handed', { deliveryId: DeliveryId; handOverNumber: number; channel: string }] | ['send', { to: ShipId; inReplyTo?: MessageId; contentType: string; payload: string; idempotencyKey: string }] | ['ack' | 'handled', DeliveryId] | ['notHandled', { deliveryId: DeliveryId; reason: string }];

/** An agent's proxy ship's crew calls, as the fleet answers them: each logged in order; a send under a key sent before answers the same message, as the fleet's does. */
export function fakeAgentShipCrew() {
  const state: { handedState: 'handed' | 'acknowledged' | 'undeliverable'; isSendAnswering: boolean; isAckAnswering: boolean } = { handedState: 'handed', isSendAnswering: true, isAckAnswering: true };
  const log: AgentCrewCall[] = [];
  const keys = new Map<string, MessageId>();
  const crew: AgentShipCrew & { state: typeof state; log: AgentCrewCall[]; replies: () => Extract<AgentCrewCall, ['send', unknown]>[1][] } = {
    state,
    log,
    replies: () => log.flatMap((call) => (call[0] === 'send' ? [call[1]] : [])),
    pushReceive: () => Promise.resolve(ok([])),
    handed: (_crewToken, handOver) => {
      log.push(['handed', handOver]);
      return Promise.resolve(ok(state.handedState));
    },
    send: (_crewToken, message) => {
      if (!state.isSendAnswering) {
        return Promise.resolve(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }));
      }
      const known = keys.get(message.idempotencyKey);
      if (known !== undefined) {
        return Promise.resolve(ok({ messageId: known }));
      }
      log.push(['send', message]);
      const messageId: MessageId = `msg_01m3tbfspe96yf1rnr4ank9r${String(keys.size).padStart(2, '0')}`;
      keys.set(message.idempotencyKey, messageId);
      return Promise.resolve(ok({ messageId }));
    },
    ack: (_crewToken, deliveryId) => {
      if (!state.isAckAnswering) {
        return Promise.resolve(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }));
      }
      log.push(['ack', deliveryId]);
      return Promise.resolve(ok(undefined));
    },
    handled: (_crewToken, deliveryId) => {
      log.push(['handled', deliveryId]);
      return Promise.resolve(ok(undefined));
    },
    notHandled: (_crewToken, report) => {
      log.push(['notHandled', report]);
      return Promise.resolve(ok(undefined));
    },
  };
  return crew;
}

/** The gateway's calls to outside agents in memory, and the task each reply tells of. */
export function memoryAgentCalls(): AgentCalls & { held: Map<string, AgentCall>; replies: Map<string, { taskId: string; contextId: string }> } {
  const held = new Map<string, AgentCall>();
  const callKey = (caller: { fleetId: string; party: string }, deliveryId: string) => JSON.stringify([caller.fleetId, caller.party, deliveryId]);
  const replies = new Map<string, { taskId: string; contextId: string }>();
  const replyKey = (caller: { fleetId: string; party: string }, messageId: string) => JSON.stringify([caller.fleetId, caller.party, messageId]);
  return {
    held,
    replies,
    find: (caller, deliveryId) => Promise.resolve(held.get(callKey(caller, deliveryId))),
    save: (call) => {
      held.set(callKey(call, call.deliveryId), call);
      return Promise.resolve();
    },
    following: (caller) => Promise.resolve([...held.values()].filter((call) => call.fleetId === caller.fleetId && call.party === caller.party && call.state === 'following')),
    saveReply: (caller, reply) => {
      replies.set(replyKey(caller, reply.messageId), { taskId: reply.taskId, contextId: reply.contextId });
      return Promise.resolve();
    },
    taskOfReply: (caller, messageId) => Promise.resolve(replies.get(replyKey(caller, messageId))),
  };
}

/** Keys that name what they derive from, so a test reads them. */
export const plainAgentKeys: AgentKeys = {
  messageIdOf: (_fleetId, messageId) => `out:${messageId}`,
  replyKeyOf: (_fleetId, { taskId, event }) => `reply:${taskId}:${event}`,
};

/** The gateway's own statuses, naming their state and reason. */
export const plainGatewayStatuses: GatewayStatuses = {
  statusOf: ({ taskId, state, reason }) => ({ kind: 'status', state, json: JSON.stringify({ statusUpdate: { taskId, status: { state, reason } } }) }),
};
