import type { Actor } from '../actors/authenticate-actor.js';
import type { McpServers } from '../mcp-out/ports.js';
import type { StateParty } from '../mcp-out/state-party.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { APPROVING_SCOPE } from './approver.js';
import type { PartyStore } from './ports.js';

export type SwitchToolRefusal = DomainError<'NOT_AN_APPROVER' | 'NO_SUCH_PARTY' | 'SERVER_UNREACHABLE' | 'NO_SUCH_TOOL'>;

export type SwitchTool = (input: { actor: Actor; name: string; tool: string; isOn: boolean }) => Promise<
  Result<{ tool: string; isOn: boolean; /** Why the proxy ship's statement waits for its next one; none when the fleet sees the switch now. */ statementRefusal: string | null }, SwitchToolRefusal>
>;

/**
 * Use case: an approver switches one tool of an outside MCP server on or off
 * (aeolus-fleet#1151), for the party as a whole: every ship that may reach it
 * reaches the same tools. The switch is kept first, so a call to a tool
 * switched off is refused at once, then the proxy ship is stated anew; while
 * it cannot be, the switch waits for its next statement.
 */
export function createSwitchTool(deps: { parties: PartyStore; servers: McpServers; stateParty: StateParty }): SwitchTool {
  return async ({ actor, name, tool, isOn }) => {
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
    if (!names.includes(tool)) {
      return refuse('NO_SUCH_TOOL', `The MCP server of ${name} lists no tool ${tool} now`);
    }
    await deps.parties.switchTools({ fleetId: actor.fleetId, name }, { listed: names, switched: new Map([[tool, isOn]]) });
    const stated = await deps.stateParty({ fleetId: actor.fleetId, name });
    return ok({ tool, isOn, statementRefusal: stated.isOk ? null : stated.error.message });
  };
}
