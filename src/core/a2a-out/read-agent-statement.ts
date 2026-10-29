import type { Statement, CallTiming } from '../mcp-out/statement.js';
import { refuse, type DomainError } from '../shared/errors.js';
import type { Result } from '../shared/result.js';
import { agentStatementOf } from './agent-statement.js';
import type { AgentCards } from './ports.js';

/** The statement of an outside A2A agent's proxy ship from its card as read now: refused when the card does not answer, is no AgentCard or makes no valid statement. */
export async function readAgentStatement(
  deps: { cards: AgentCards; timing: CallTiming },
  agent: { name: string; cardUrl: string; isRepeatable: boolean; scopes: readonly string[] },
): Promise<Result<Statement, DomainError<'CARD_UNREACHABLE' | 'CARD_INVALID'>>> {
  const card = await deps.cards.read(agent.cardUrl);
  if (!card.isOk) {
    return card.error.kind === 'UNREACHABLE'
      ? refuse('CARD_UNREACHABLE', `The card of ${agent.name} could not be read: ${card.error.reason}`)
      : refuse('CARD_INVALID', `The card address of ${agent.name} answers no agent card: ${card.error.reason}`);
  }
  return agentStatementOf({ partyName: agent.name, card: card.value, isRepeatable: agent.isRepeatable, timing: deps.timing, scopes: agent.scopes });
}
