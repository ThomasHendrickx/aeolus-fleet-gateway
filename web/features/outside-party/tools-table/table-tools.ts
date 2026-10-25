/**
 * The rows of an outside MCP server's tools table (gateway scopes 4.3):
 * each tool the server lists now, with its switch, the hints it gives and
 * the scopes it needs of its own; and the filters an approver narrows them by.
 */
import type { Read } from '../../../lib/gateway-api/page-api';

/** A tool as the server lists it now, with its switch, as the API answers it. */
export interface ListedTool {
  name: string;
  description?: string | undefined;
  isReadOnly?: boolean | undefined;
  isDestructive?: boolean | undefined;
  isOn: boolean;
  isNew: boolean;
}

/** A party's required scopes as the API answers them. */
export interface PartyRequirements {
  version: number;
  party: string[];
  tools: { tool: string; scopes: string[] }[];
}

/** One row: the tool, its switch (unknown while the server does not answer), and the scopes it needs of its own. */
export interface TableTool {
  name: string;
  description?: string | undefined;
  isReadOnly?: boolean | undefined;
  isDestructive?: boolean | undefined;
  isOn: boolean | null;
  isNew: boolean;
  scopes: readonly string[];
}

/**
 * The rows: every tool the server lists with what it needs; while the server
 * does not answer, the requirements kept per tool name, so they can still be
 * read and changed.
 */
export function tableToolsOf({ read, requirements }: { read: Read<{ tools: ListedTool[] }>; requirements: PartyRequirements }): TableTool[] {
  const own = new Map(requirements.tools.map(({ tool, scopes }) => [tool, scopes]));
  if (!read.isOk) {
    return requirements.tools.map(({ tool, scopes }) => ({ name: tool, isOn: null, isNew: false, scopes }));
  }
  return read.value.tools.map((tool) => ({ ...tool, scopes: own.get(tool.name) ?? [] }));
}

/** The table's state filter. */
export const STATE_FILTERS = [
  { state: 'all', label: 'All' },
  { state: 'on', label: 'On' },
  { state: 'off', label: 'Off' },
  { state: 'new', label: 'New' },
  { state: 'needsNothing', label: 'Needs nothing' },
] as const;

export type StateFilter = (typeof STATE_FILTERS)[number]['state'];

function isInState(tool: TableTool, { state, partyScopes }: { state: StateFilter; partyScopes: readonly string[] }): boolean {
  switch (state) {
    case 'all':
      return true;
    case 'on':
      return tool.isOn === true;
    case 'off':
      return tool.isOn === false;
    case 'new':
      return tool.isNew;
    case 'needsNothing':
      return partyScopes.length === 0 && tool.scopes.length === 0;
  }
}

/** The tools whose name holds the text, in any case, and that are in the state picked. */
export function shownTools(tools: readonly TableTool[], filter: { name: string; state: StateFilter; partyScopes: readonly string[] }): TableTool[] {
  const name = filter.name.trim().toLowerCase();
  return tools.filter((tool) => tool.name.toLowerCase().includes(name) && isInState(tool, filter));
}
