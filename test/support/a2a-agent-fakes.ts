/**
 * Stand-ins for A2A out (slice 5): an outside agent's card, and the cards
 * the gateway reads, by address, as told.
 */
import type { AgentCard, AgentCards, CardFailure } from '../../src/core/a2a-out/ports.js';
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
