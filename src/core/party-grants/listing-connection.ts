import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import type { McpServerCredential, McpServerPartyCredential } from '../vault/credential.js';
import type { PartyGrants } from './ports.js';

/** How the gateway lists a server's tools: with the credential it keeps, or for a server where each person signs in, under a person's grant; none while nobody holds a usable one. */
export type ListingConnectionOf = (server: ListedServer) => Promise<ListingConnection | undefined>;

/** An outside MCP server whose tools are listed: where it is and how the gateway signs in to it. */
export interface ListedServer {
  readonly fleetId: FleetId;
  readonly name: string;
  readonly url: string;
  readonly credential: McpServerPartyCredential;
}

/** Where to list a server's tools, and with which credential. */
export interface ListingConnection {
  readonly url: string;
  readonly credential: McpServerCredential;
}

/**
 * The connection a server's tools are listed with, for its proxy ship's
 * statement and its tool switches. A server where each person signs in
 * lists under any usable grant, the most recently used first (decision
 * 0067, Q15): its access token goes as the bearer, as it would for that
 * person's own call.
 */
export function createListingConnectionOf(deps: { grants: Pick<PartyGrants, 'usable'>; clock: Clock }): ListingConnectionOf {
  return async (server) => {
    if (server.credential.kind !== 'personSignIn') {
      return { url: server.url, credential: server.credential };
    }
    const grant = await deps.grants.usable(server.fleetId, { party: server.name, now: deps.clock.now() });
    return grant === undefined ? undefined : { url: server.url, credential: { kind: 'bearer', token: grant.accessToken } };
  };
}
