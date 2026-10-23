import type { DeliveryId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  CARD_URL,
  aMovingClock,
  aStatus,
  anAgentCard,
  anAgentParty,
  answeredCard,
  fakeA2aAgents,
  fakeAgentCards,
  fakeAgentShipCrew,
  memoryAgentCalls,
  plainAgentKeys,
  plainGatewayStatuses,
} from '../../../test/support/a2a-agent-fakes.js';
import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { CALLER_SHIP_ID, aPushedDelivery } from '../../../test/support/mcp-out-fakes.js';
import { memoryPartyStore } from '../../../test/support/party-fakes.js';
import { ok } from '../shared/result.js';
import { createFollowAgentTask } from './follow-agent-task.js';
import { createHandA2aMessage } from './hand-a2a-message.js';
import { createRunA2aAgent } from './run-a2a-agent.js';

const POLL_MS = 2_000;
const CARD_WAIT_MS = 30_000;
const FOLLOWED: DeliveryId = 'dlv_01m3tbfspe96yf1rnr4ank9d09';
const STREAMING_CARD = anAgentCard({
  isStreaming: true,
  supportedInterfaces: [
    { url: 'https://agent.supplier.example/grpc', protocolBinding: 'GRPC', protocolVersion: '1.0' },
    { url: 'https://agent.supplier.example/rest', protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' },
  ],
});

let crew: ReturnType<typeof fakeAgentShipCrew>;
let calls: ReturnType<typeof memoryAgentCalls>;
let parties: ReturnType<typeof memoryPartyStore>;
let clock: ReturnType<typeof aMovingClock>;
let stop: AbortController;
let slept: number[];

beforeEach(async () => {
  crew = fakeAgentShipCrew();
  calls = memoryAgentCalls();
  parties = memoryPartyStore();
  await parties.save(anAgentParty());
  clock = aMovingClock();
  stop = new AbortController();
  slept = [];
});

/** The agent's worker, its crew taking the deliveries given once, then stopped. */
function runWith(cards: ReturnType<typeof fakeAgentCards>, agents: ReturnType<typeof fakeA2aAgents>, waiting = [aPushedDelivery({ contentType: 'text/plain', payload: 'Quote 10 bolts' })]) {
  let isTaken = false;
  crew.pushReceive = () => {
    if (isTaken) {
      stop.abort();
      return Promise.resolve(ok([]));
    }
    isTaken = true;
    return Promise.resolve(ok(waiting));
  };
  const sleep = (ms: number) => {
    slept.push(ms);
    clock.advance(ms);
    if (slept.length > 3) {
      stop.abort();
    }
    return Promise.resolve();
  };
  const follow = createFollowAgentTask({ crew, agents, calls, keys: plainAgentKeys, statuses: plainGatewayStatuses, clock, sleep, pollMs: POLL_MS, deadlineMs: 60_000 });
  const hand = createHandA2aMessage({ crew, agents, calls, keys: plainAgentKeys, statuses: plainGatewayStatuses, parties, follow, clock, deadlineMs: 60_000 });
  const run = createRunA2aAgent({ cards, crew, hand, follow, calls, sleep, pollMs: POLL_MS, againWaitsMs: [1_000], cardWaitMs: CARD_WAIT_MS });
  return run({ party: anAgentParty(), signal: stop.signal });
}

describe("an outside A2A agent's worker (slice 6)", () => {
  it("hands each message to the first interface of the card the gateway calls, followed as the card states", async () => {
    const agents = fakeA2aAgents({ sends: [{ kind: 'task', taskId: 'task-1', contextId: 'ctx-1', events: [aStatus('completed')] }] });

    await runWith(fakeAgentCards({ [CARD_URL]: answeredCard(STREAMING_CARD) }), agents);

    expect(agents.sent.map(({ connection }) => connection.endpoint)).toEqual([{ url: 'https://agent.supplier.example/rest', protocolBinding: 'HTTP+JSON', isStreaming: true }]);
  });

  it('follows first the tasks it followed when it stopped', async () => {
    await calls.save({ deliveryId: FOLLOWED, fleetId: FLEET_ID, party: 'supplier', messageId: 'msg_01m3tbfspe96yf1rnr4ank9m09', senderShipId: CALLER_SHIP_ID, state: 'following', taskId: 'task-9', contextId: 'ctx-9', deadlineAt: new Date('2026-10-23T13:00:00.000Z') });
    const agents = fakeA2aAgents({ reads: [{ kind: 'read', events: [aStatus('completed', 'task-9')] }] });

    await runWith(fakeAgentCards({ [CARD_URL]: answeredCard() }), agents, []);

    expect({ read: agents.read, handled: crew.log.filter(([kind]) => kind === 'handled') }).toEqual({ read: ['task-9'], handled: [['handled', FOLLOWED]] });
  });

  it('takes no message while its card cannot be read or names no interface the gateway calls, and reads it again after a wait', async () => {
    const cards = fakeAgentCards({ [CARD_URL]: answeredCard(anAgentCard({ supportedInterfaces: [{ url: 'https://agent.supplier.example/grpc', protocolBinding: 'GRPC', protocolVersion: '1.0' }] })) });
    const agents = fakeA2aAgents();

    await runWith(cards, agents);

    expect({ sent: agents.sent, reads: cards.reads.length, slept: slept.slice(0, 2) }).toEqual({ sent: [], reads: 4, slept: [CARD_WAIT_MS, CARD_WAIT_MS] });
  });
});
