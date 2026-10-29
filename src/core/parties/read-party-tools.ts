import type { FleetId } from '@aeolus-fleet/common';

import type { McpServers } from '../mcp-out/ports.js';
import type { ListingConnectionOf } from '../party-grants/listing-connection.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { PartyStore } from './ports.js';
import { switchedToolsOf, type SwitchedTool } from './tool-switches.js';

export type ReadPartyTools = (party: { fleetId: FleetId; name: string }) => Promise<Result<{ tools: SwitchedTool[] }, DomainError<'NO_SUCH_PARTY' | 'NOT_SIGNED_IN' | 'SERVER_UNREACHABLE'>>>;

/**
 * Use case: an outside MCP server's tools, as the server lists them now,
 * asked with the credential the gateway keeps for it, or under a person's
 * grant where each person signs in (decision 0067), each with its switch
 * (aeolus-fleet#1151). It keeps nothing:
 * the proxy ship's statement in the fleet is where the tools live, and
 * core does not answer a statement to a reader yet, so the server is asked.
 */
export function createReadPartyTools(deps: { parties: PartyStore; servers: McpServers; connectionOf: ListingConnectionOf }): ReadPartyTools {
  return async ({ fleetId, name }) => {
    const party = await deps.parties.find(fleetId, name);
    if (party?.kind !== 'mcpServer') {
      return refuse('NO_SUCH_PARTY', `There is no outside MCP server ${name}`);
    }
    const connection = await deps.connectionOf(party);
    if (connection === undefined) {
      return refuse('NOT_SIGNED_IN', `Nobody holds a usable sign-in to ${name}, so its tools cannot be listed`);
    }
    const listed = await deps.servers.listTools(connection);
    if (!listed.isOk) {
      return refuse('SERVER_UNREACHABLE', `The MCP server of ${name} could not be listed: ${listed.error.reason}`);
    }
    return ok({ tools: switchedToolsOf(listed.value, party.toolSwitches) });
  };
}
