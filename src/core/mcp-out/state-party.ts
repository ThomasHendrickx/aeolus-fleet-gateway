import type { FleetId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { PartyStore } from '../parties/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { McpServers } from './ports.js';
import { statementOf, type Statement } from './statement.js';

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
  Result<{ capabilities: string[] }, DomainError<'NO_SUCH_PARTY' | 'NOT_CREWED' | 'SERVER_UNREACHABLE' | 'STATEMENT_REFUSED'>>
>;

/**
 * Use case: the gateway states what a party's proxy ship offers, as its
 * crew: the tools its server lists now, with argo's marks. The whole
 * statement replaces the one before, so a tool the server dropped is gone.
 */
export function createStateParty(deps: { parties: PartyStore; servers: McpServers; door: StatementDoor; marks: ToolMarks }): StateParty {
  return async ({ fleetId, name }) => {
    const party = await deps.parties.find(fleetId, name);
    if (!party) {
      return refuse('NO_SUCH_PARTY', `No party named ${name}`);
    }
    if (party.state !== 'crewed' || party.crewToken === null) {
      return refuse('NOT_CREWED', `The gateway does not crew the proxy ship of ${name} yet`);
    }
    const listed = await deps.servers.listTools({ url: party.url, credential: party.credential });
    if (!listed.isOk) {
      return refuse('SERVER_UNREACHABLE', `The MCP server of ${name} could not be listed: ${listed.error.reason}`);
    }
    const statement = statementOf({ partyName: name, tools: listed.value, repeatable: await deps.marks.repeatable(fleetId, name) });
    const stated = await deps.door.setStatement(party.crewToken, statement);
    if (!stated.isOk) {
      return refuse('STATEMENT_REFUSED', `The fleet refused the statement: ${stated.error.message}`);
    }
    return ok({ capabilities: statement.capabilities.map((capability) => capability.name) });
  };
}
