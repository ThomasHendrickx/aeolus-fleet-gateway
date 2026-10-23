/**
 * Stand-ins for A2A out (slice 5): an outside agent's card, and the cards
 * the gateway reads, by address, as told.
 */
import type { AgentCard, AgentCards, CardFailure } from '../../src/core/a2a-out/ports.js';
import { err, ok, type Result } from '../../src/core/shared/result.js';

export const CARD_URL = 'https://agent.supplier.example/.well-known/agent-card.json';

export function anAgentCard(change: Partial<AgentCard> = {}): AgentCard {
  return {
    name: 'Supplier agent',
    description: 'Quotes and books parts.',
    supportedInterfaces: [{ url: 'https://agent.supplier.example/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['application/json'],
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
