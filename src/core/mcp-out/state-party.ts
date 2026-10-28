import type { FleetId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { PartyStore, ScopeRequirementsStore } from '../parties/ports.js';
import type { ListingConnectionOf } from '../party-grants/listing-connection.js';
import { isToolOn } from '../parties/tool-switches.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { McpServers } from './ports.js';
import { statementOf, type CallTiming, type Statement } from './statement.js';

/** Outbound port: the fleet's `setStatement`, called as a proxy ship's crew. */
export interface StatementDoor {
  setStatement(crewToken: string, statement: Statement): Promise<Result<void, FleetRefusal>>;
}

/** Outbound port: argo's repeatable marks, by party and tool. */
export interface ToolMarks {
  /** The tools of the party argo marked repeatable. */
  repeatable(fleetId: FleetId, party: string): Promise<ReadonlySet<string>>;
  mark(fleetId: FleetId, mark: { party: string; tool: string; isRepeatable: boolean }): Promise<void>;
}

export type StateParty = (input: { fleetId: FleetId; name: string }) => Promise<
  Result<{ capabilities: string[] }, DomainError<'NO_SUCH_PARTY' | 'NOT_CREWED' | 'NOT_SIGNED_IN' | 'SERVER_UNREACHABLE' | 'STATEMENT_REFUSED'>>
>;

/**
 * Use case: the gateway states what a party's proxy ship offers, as its
 * crew: the tools its server lists now that are switched on, with argo's
 * marks and the scopes each tool needs now. The whole statement replaces the one before, so a tool the server
 * dropped or an approver switched off is gone. A party with no switches kept
 * keeps every tool it lists on first (aeolus-fleet#1151). A server where each
 * person signs in is listed under a person's grant (decision 0067).
 */
export function createStateParty(deps: {
  parties: PartyStore;
  servers: McpServers;
  connectionOf: ListingConnectionOf;
  door: StatementDoor;
  marks: ToolMarks;
  requirements: ScopeRequirementsStore;
  timing: CallTiming;
}): StateParty {
  return async ({ fleetId, name }) => {
    const party = await deps.parties.find(fleetId, name);
    if (party?.kind !== 'mcpServer') {
      return refuse('NO_SUCH_PARTY', `No party named ${name}`);
    }
    if (party.state !== 'crewed' || party.crewToken === null) {
      return refuse('NOT_CREWED', `The gateway does not crew the proxy ship of ${name} yet`);
    }
    const connection = await deps.connectionOf(party);
    if (connection === undefined) {
      return refuse('NOT_SIGNED_IN', `Nobody holds a usable sign-in to ${name}, so its tools cannot be listed`);
    }
    const listed = await deps.servers.listTools(connection);
    if (!listed.isOk) {
      return refuse('SERVER_UNREACHABLE', `The MCP server of ${name} could not be listed: ${listed.error.reason}`);
    }
    if (party.toolSwitches === null) {
      await deps.parties.switchTools({ fleetId, name }, { listed: listed.value.map((tool) => tool.name), switched: new Map() });
    }
    const tools = listed.value.filter((tool) => isToolOn(party.toolSwitches, tool.name));
    const statement = statementOf({ partyName: name, tools, repeatable: await deps.marks.repeatable(fleetId, name), timing: deps.timing, requirements: await deps.requirements.find(fleetId, name) });
    const stated = await deps.door.setStatement(party.crewToken, statement);
    if (!stated.isOk) {
      return refuse('STATEMENT_REFUSED', `The fleet refused the statement: ${stated.error.message}`);
    }
    return ok({ capabilities: statement.capabilities.map((capability) => capability.name) });
  };
}
