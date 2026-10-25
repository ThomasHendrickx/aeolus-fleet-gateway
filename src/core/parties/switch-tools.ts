import type { Actor } from '../actors/authenticate-actor.js';
import type { McpServers } from '../mcp-out/ports.js';
import type { StateParty } from '../mcp-out/state-party.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { APPROVING_SCOPE } from './approver.js';
import type { PartyStore } from './ports.js';

export type SwitchToolsRefusal = DomainError<'NOT_AN_APPROVER' | 'NO_SUCH_PARTY' | 'SERVER_UNREACHABLE' | 'NO_SUCH_TOOL'>;

export type SwitchTools = (input: { actor: Actor; name: string; tools: readonly string[]; isOn: boolean }) => Promise<
  Result<{ tools: string[]; isOn: boolean; /** Why the proxy ship's statement waits for its next one; none when the fleet sees the switches now. */ statementRefusal: string | null }, SwitchToolsRefusal>
>;

/**
 * Use case: an approver switches tools of an outside MCP server on or off
 * (aeolus-fleet#1151), one or every one selected on its page (gateway scopes
 * 4.3), for the party as a whole: every ship that may reach it reaches the
 * same tools. The selection is kept in one change, all of it or none, so a
 * call to a tool switched off is refused at once, then the proxy ship is
 * stated anew once; while it cannot be, the switches wait for its next
 * statement.
 */
export function createSwitchTools(deps: { parties: PartyStore; servers: McpServers; stateParty: StateParty }): SwitchTools {
  return async ({ actor, name, tools, isOn }) => {
    if (!actor.scopes.includes(APPROVING_SCOPE)) {
      return refuse('NOT_AN_APPROVER', `Switching an outside party's tools needs ${APPROVING_SCOPE}`);
    }
    const party = await deps.parties.find(actor.fleetId, name);
    if (party?.kind !== 'mcpServer') {
      return refuse('NO_SUCH_PARTY', `There is no outside MCP server ${name}`);
    }
    const listed = await deps.servers.listTools({ url: party.url, credential: party.credential });
    if (!listed.isOk) {
      return refuse('SERVER_UNREACHABLE', `The MCP server of ${name} could not be listed: ${listed.error.reason}`);
    }
    const names = listed.value.map((each) => each.name);
    const unlisted = tools.filter((tool) => !names.includes(tool));
    if (unlisted.length > 0) {
      return refuse('NO_SUCH_TOOL', `The MCP server of ${name} lists no tool ${unlisted.join(' or ')} now`);
    }
    await deps.parties.switchTools({ fleetId: actor.fleetId, name }, { listed: names, switched: new Map(tools.map((tool) => [tool, isOn])) });
    const stated = await deps.stateParty({ fleetId: actor.fleetId, name });
    return ok({ tools: [...tools], isOn, statementRefusal: stated.isOk ? null : stated.error.message });
  };
}
