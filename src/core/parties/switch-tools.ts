import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential, CredentialOf } from '../actors/credential-of.js';
import type { ConnectionStore } from '../connection/ports.js';
import type { McpServers } from '../mcp-out/ports.js';
import type { StateParty } from '../mcp-out/state-party.js';
import type { ListingConnectionOf } from '../party-grants/listing-connection.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { approvedParty, type ApprovingRefusal } from './check-approving.js';
import type { PartyStore, ProxyShipsAsActor } from './ports.js';

export type SwitchToolsRefusal = ApprovingRefusal | DomainError<'NOT_SIGNED_IN' | 'SERVER_UNREACHABLE' | 'NO_SUCH_TOOL'>;

export type SwitchTools = (input: { actor: Actor; as: ActorCredential; name: string; tools: readonly string[]; isOn: boolean }) => Promise<
  Result<{ tools: string[]; isOn: boolean; /** Why the proxy ship's statement waits for its next one; none when the fleet sees the switches now. */ statementRefusal: string | null }, SwitchToolsRefusal>
>;

/**
 * Use case: an approver switches tools of an outside MCP server on or off
 * (aeolus-fleet#1151), one or every one selected on its page (gateway scopes
 * 4.3), for the party as a whole: every ship that may reach it reaches the
 * same tools. The fleet, asked as the approver, must answer that it manages
 * the proxy ship before anything changes (A2). The selection is kept in one change, all of it or none, so a
 * call to a tool switched off is refused at once, then the proxy ship is
 * stated anew once; while it cannot be, the switches wait for its next
 * statement.
 */
export function createSwitchTools(deps: {
  parties: PartyStore;
  servers: McpServers;
  connectionOf: ListingConnectionOf;
  stateParty: StateParty;
  connections: Pick<ConnectionStore, 'find'>;
  fleet: Pick<ProxyShipsAsActor, 'checkManage'>;
  credentialOf: CredentialOf;
}): SwitchTools {
  return async ({ actor, as, name, tools, isOn }) => {
    const approved = await approvedParty(deps, { actor, as, name });
    if (!approved.isOk) {
      return approved;
    }
    const { party } = approved.value;
    if (party.kind !== 'mcpServer') {
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
