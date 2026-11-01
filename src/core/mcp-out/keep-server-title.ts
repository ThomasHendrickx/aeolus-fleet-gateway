import type { PartyStore } from '../parties/ports.js';
import type { ConnectedServer, McpServerConnection } from './ports.js';

/** Keeps what a server named itself as on a connect. */
export type KeepServerTitle = (connection: McpServerConnection, server: ConnectedServer) => Promise<void>;

/**
 * Use case: on each connect to a party's MCP server, the gateway keeps the
 * title the server gave in its serverInfo as the party's display name, and
 * none once it gives none, never its technical name (Thomas,
 * aeolus-fleet#1535). A server checked before it is a party keeps nothing.
 */
export function createKeepServerTitle(deps: { parties: Pick<PartyStore, 'keepDisplayName'> }): KeepServerTitle {
  return async ({ party }, { title }) => {
    if (party !== undefined) {
      await deps.parties.keepDisplayName(party, title);
    }
  };
}
