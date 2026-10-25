import { z } from 'zod';

import type { ScopeRequirementsStore } from '../../core/parties/ports.js';
import { changedRequirements, NO_SCOPE_REQUIREMENTS, type ScopeRequirements } from '../../core/parties/scope-requirements.js';
import type { Db } from './client.js';

/** The requirements as the party's row keeps them: the party's set and each tool's set by name, or none set yet. */
const keptSchema = z.object({ party: z.array(z.string()), tools: z.record(z.string(), z.array(z.string())) }).nullable();

function requirementsOf(row: { scopeRequirements: unknown; scopeRequirementsVersion: number }): ScopeRequirements {
  const kept = keptSchema.parse(row.scopeRequirements);
  return kept === null ? { ...NO_SCOPE_REQUIREMENTS, version: row.scopeRequirementsVersion } : { version: row.scopeRequirementsVersion, party: kept.party, tools: new Map(Object.entries(kept.tools)) };
}

/**
 * Each party's required scopes, kept on its row, so retiring the party
 * removes them and saving it again keeps them. A change writes only while
 * the row is still at the version it was made on: of two changes at once on
 * the same version, the row's lock lets one write and the other finds the
 * version moved on.
 */
export function createPrismaScopeRequirements(db: Db): ScopeRequirementsStore {
  const read = async (fleetId: string, name: string) =>
    db.party.findUnique({ where: { fleetId_name: { fleetId, name } }, select: { scopeRequirements: true, scopeRequirementsVersion: true } });
  return {
    find: async (fleetId, party) => {
      const row = await read(fleetId, party);
      return row === null ? NO_SCOPE_REQUIREMENTS : requirementsOf(row);
    },
    change: async ({ fleetId, name }, change) => {
      const row = await read(fleetId, name);
      if (row?.scopeRequirementsVersion !== change.version) {
        return undefined;
      }
      const changed = changedRequirements(requirementsOf(row), change);
      const written = await db.party.updateMany({
        where: { fleetId, name, scopeRequirementsVersion: change.version },
        data: { scopeRequirements: { party: [...changed.party], tools: Object.fromEntries([...changed.tools].map(([tool, scopes]) => [tool, [...scopes]])) }, scopeRequirementsVersion: changed.version },
      });
      return written.count === 1 ? changed : undefined;
    },
  };
}
