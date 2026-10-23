import { createRunParty, type RunPartyOf, type Sleep } from '../mcp-out/run-party.js';
import type { A2aAgentParty } from '../parties/party.js';
import { agentEndpointOf, type AgentEndpoint } from './agent-endpoint.js';
import type { FollowAgentTask } from './follow-agent-task.js';
import type { HandA2aMessage } from './hand-a2a-message.js';
import type { AgentCalls, AgentCards, AgentShipCrew } from './ports.js';

export type RunA2aAgent = RunPartyOf<A2aAgentParty>;

/**
 * Use case: the gateway takes the messages of an outside A2A agent's proxy
 * ship, as its crew, until it is stopped (slice 6, flow 4.2). The card is
 * read at the start for where the agent is called: the first interface the
 * gateway calls, followed by SubscribeToTask when it states streaming.
 * While the card cannot be read or names no such interface, no message is
 * taken and the card is read again after a wait. The tasks followed when
 * the gateway stopped are followed first, each in flight as its delivery.
 */
export function createRunA2aAgent(deps: {
  cards: AgentCards;
  crew: Pick<AgentShipCrew, 'pushReceive'>;
  hand: HandA2aMessage;
  follow: FollowAgentTask;
  calls: AgentCalls;
  sleep: Sleep;
  pollMs: number;
  againWaitsMs: readonly number[];
  cardWaitMs: number;
}): RunA2aAgent {
  const endpointOf = async (party: A2aAgentParty, signal: AbortSignal): Promise<AgentEndpoint | undefined> => {
    while (!signal.aborted) {
      const card = await deps.cards.read(party.cardUrl);
      const endpoint = card.isOk ? agentEndpointOf(card.value) : undefined;
      if (endpoint !== undefined) {
        return endpoint;
      }
      await deps.sleep(deps.cardWaitMs, signal);
    }
    return undefined;
  };

  return async ({ party, signal }) => {
    if (party.crewToken === null) {
      return { ended: 'crewRefused' };
    }
    const endpoint = await endpointOf(party, signal);
    if (endpoint === undefined) {
      return { ended: 'stopped' };
    }
    const run = createRunParty<A2aAgentParty>({
      crew: deps.crew,
      handCall: ({ delivery }) => deps.hand({ party, endpoint, delivery, signal }),
      resume: async () =>
        (await deps.calls.following({ fleetId: party.fleetId, party: party.name })).map((call) => ({
          deliveryId: call.deliveryId,
          hand: () => deps.follow({ party, endpoint, call, signal }),
        })),
      sleep: deps.sleep,
      pollMs: deps.pollMs,
      againWaitsMs: deps.againWaitsMs,
    });
    return run({ party, signal });
  };
}
