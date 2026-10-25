import type { FleetId } from '@aeolus-fleet/common';

import type { StatementDoor } from '../mcp-out/state-party.js';
import type { CallTiming } from '../mcp-out/statement.js';
import type { PartyStore, ScopeRequirementsStore } from '../parties/ports.js';
import { scopesNeeded } from '../parties/scope-requirements.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { AgentCards } from './ports.js';
import { readAgentStatement } from './read-agent-statement.js';

export type StateA2aAgent = (input: { fleetId: FleetId; name: string }) => Promise<
  Result<{ capabilities: string[] }, DomainError<'NO_SUCH_PARTY' | 'NOT_CREWED' | 'CARD_UNREACHABLE' | 'CARD_INVALID' | 'STATEMENT_REFUSED'>>
>;

/**
 * Use case: the gateway states what an outside A2A agent's proxy ship
 * offers, as its crew (slice 5): the skills of its card as read now, with
 * the agent's repeatable mark (A9) and the scopes it needs now. The whole statement replaces the one
 * before. A card that does not answer or is no longer valid states nothing,
 * so the last statement stays.
 */
export function createStateA2aAgent(deps: { parties: PartyStore; cards: AgentCards; door: StatementDoor; requirements: ScopeRequirementsStore; timing: CallTiming }): StateA2aAgent {
  return async ({ fleetId, name }) => {
    const party = await deps.parties.find(fleetId, name);
    if (party?.kind !== 'a2aAgent') {
      return refuse('NO_SUCH_PARTY', `No A2A agent named ${name}`);
    }
    if (party.state !== 'crewed' || party.crewToken === null) {
      return refuse('NOT_CREWED', `The gateway does not crew the proxy ship of ${name} yet`);
    }
    const statement = await readAgentStatement(deps, { ...party, scopes: scopesNeeded(await deps.requirements.find(fleetId, name), null) });
    if (!statement.isOk) {
      return statement;
    }
    const stated = await deps.door.setStatement(party.crewToken, statement.value);
    if (!stated.isOk) {
      return refuse('STATEMENT_REFUSED', `The fleet refused the statement: ${stated.error.message}`);
    }
    return ok({ capabilities: statement.value.capabilities.map((capability) => capability.name) });
  };
}
