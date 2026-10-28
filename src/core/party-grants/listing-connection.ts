import type { McpServerConnection } from '../mcp-out/ports.js';
import type { McpServerParty } from '../parties/party.js';
import type { Clock } from '../shared/clock.js';
import type { PartyGrants } from './ports.js';

/** How the gateway lists a server's tools: with the credential it keeps, or for a server where each person signs in, under a person's grant; none while nobody holds a usable one. */
export type ListingConnectionOf = (party: McpServerParty) => Promise<McpServerConnection | undefined>;

/**
 * The connection a server's tools are listed with, for its proxy ship's
 * statement and its tool switches. A server where each person signs in
 * lists under any usable grant, the most recently used first (decision
 * 0067, Q15): its access token goes as the bearer, as it would for that
 * person's own call.
 */
export function createListingConnectionOf(deps: { grants: Pick<PartyGrants, 'usable'>; clock: Clock }): ListingConnectionOf {
  return async (party) => {
    if (party.credential.kind !== 'personSignIn') {
      return { url: party.url, credential: party.credential };
    }
    const grant = await deps.grants.usable(party.fleetId, { party: party.name, now: deps.clock.now() });
    return grant === undefined ? undefined : { url: party.url, credential: { kind: 'bearer', token: grant.accessToken } };
  };
}
