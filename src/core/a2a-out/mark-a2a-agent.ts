import type { Actor } from '../actors/authenticate-actor.js';
import { APPROVING_SCOPE } from '../parties/approver.js';
import type { PartyStore } from '../parties/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { StateA2aAgent } from './state-a2a-agent.js';

export type MarkA2aAgentRefusal = DomainError<'NOT_AN_APPROVER' | 'NO_SUCH_PARTY'>;

export type MarkA2aAgent = (input: { actor: Actor; name: string; isRepeatable: boolean }) => Promise<
  Result<{ isRepeatable: boolean; /** Why the proxy ship's statement waits for its next one; none when the fleet sees the mark now. */ statementRefusal: string | null }, MarkA2aAgentRefusal>
>;

/**
 * Use case: an actor holding gateway:approve marks an outside A2A agent not
 * repeatable, or repeatable again (A9): the whole agent, as A2A names no
 * call apart from its message. The mark is kept first, then the proxy ship
 * is stated anew; while it cannot be, the mark waits for its next statement.
 */
export function createMarkA2aAgent(deps: { parties: PartyStore; stateA2aAgent: StateA2aAgent }): MarkA2aAgent {
  return async ({ actor, name, isRepeatable }) => {
    if (!actor.scopes.includes(APPROVING_SCOPE)) {
      return refuse('NOT_AN_APPROVER', `Marking an outside A2A agent needs ${APPROVING_SCOPE}`);
    }
    const party = await deps.parties.find(actor.fleetId, name);
    if (party?.kind !== 'a2aAgent') {
      return refuse('NO_SUCH_PARTY', `There is no outside A2A agent ${name}`);
    }
    await deps.parties.save({ ...party, isRepeatable });
    const stated = await deps.stateA2aAgent({ fleetId: actor.fleetId, name });
    return ok({ isRepeatable, statementRefusal: stated.isOk ? null : stated.error.message });
  };
}
