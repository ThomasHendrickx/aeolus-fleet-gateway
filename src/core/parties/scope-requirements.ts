/**
 * Which scopes a calling ship must hold to use an outside party (design
 * gateway-scopes, 4.2): a set for the party as a whole, and for an outside
 * MCP server a set per tool. A tool needs both sets, every scope in them
 * (A5). A scope says what a ship may do; which party it reaches stays the
 * network rules' (L1). Kept by scope text and tool name, never by a ship.
 */

/** A party's required scopes, and the version they were changed to last, so two approvers never overwrite each other unseen. */
export interface ScopeRequirements {
  readonly version: number;
  /** What every call to the party needs; an A2A agent has only this set, as its messages name no tool (L26). */
  readonly party: readonly string[];
  /** What each tool needs beside the party's set, by tool name; a tool not named needs only the party's. */
  readonly tools: ReadonlyMap<string, readonly string[]>;
}

/** A party with nothing required: every call needs only to reach it. */
export const NO_SCOPE_REQUIREMENTS: ScopeRequirements = { version: 0, party: [], tools: new Map() };

/** A change to a party's requirements: its own set when given, and each tool's set given, an empty one dropping the tool's. */
export interface ScopeRequirementsChange {
  readonly party?: readonly string[];
  readonly tools: ReadonlyMap<string, readonly string[]>;
}

/** The requirements after a change, at the next version. */
export function changedRequirements(kept: ScopeRequirements, change: ScopeRequirementsChange): ScopeRequirements {
  const tools = new Map(kept.tools);
  for (const [tool, scopes] of change.tools) {
    if (scopes.length === 0) {
      tools.delete(tool);
    } else {
      tools.set(tool, scopes);
    }
  }
  return { version: kept.version + 1, party: change.party ?? kept.party, tools };
}

/** Every scope a call needs: the party's set and the tool's own, each once; a party called as a whole (no tool) needs its set alone. */
export function scopesNeeded(requirements: ScopeRequirements, tool: string | null): string[] {
  const own = tool === null ? [] : (requirements.tools.get(tool) ?? []);
  return [...new Set([...requirements.party, ...own])];
}

/** The needed scopes the calling ship does not hold. */
export function scopesLacking(needed: readonly string[], held: readonly string[]): string[] {
  return needed.filter((scope) => !held.includes(scope));
}

/** A refusal naming what is missing (P2): "update_lead needs crm:write-leads, which lead-scout does not hold". */
export function lackingScopesMessage(refused: { needing: string; lacking: readonly string[]; shipName: string }): string {
  const scopes = refused.lacking.length === 1 ? refused.lacking.join('') : `${refused.lacking.slice(0, -1).join(', ')} and ${refused.lacking.at(-1) ?? ''}`;
  return `${refused.needing} needs ${scopes}, which ${refused.shipName} does not hold`;
}
