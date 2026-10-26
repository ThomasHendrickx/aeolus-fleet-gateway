import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { PartyStore, ScopeRequirementsStore } from './ports.js';
import type { ScopeRequirements } from './scope-requirements.js';

export type ReadScopeRequirements = (input: { fleetId: FleetId; name: string }) => Promise<Result<ScopeRequirements, DomainError<'NO_SUCH_PARTY'>>>;

/**
 * Use case: which scopes an outside MCP server or A2A agent needs, and the
 * version an approver changes them on (design gateway-scopes, 4.2). Anyone
 * in the fleet reads them, as its tools are read.
 */
export function createReadScopeRequirements(deps: { parties: PartyStore; requirements: ScopeRequirementsStore }): ReadScopeRequirements {
  return async ({ fleetId, name }) => {
    const party = await deps.parties.find(fleetId, name);
    if (party?.kind !== 'mcpServer' && party?.kind !== 'a2aAgent') {
      return refuse('NO_SUCH_PARTY', `There is no outside MCP server or A2A agent ${name}`);
    }
    return ok(await deps.requirements.find(fleetId, name));
  };
}
