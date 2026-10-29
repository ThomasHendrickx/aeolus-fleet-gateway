import type { FleetId } from '@aeolus-fleet/common';

import { endGrant } from './end-grant.js';
import type { PartyGrants, PartySignIns, SignInServers } from './ports.js';

export type EndAccountGrants = (account: { fleetId: FleetId; accountId: string }) => Promise<void>;

/**
 * Use case: pagasae disabled the account and tells the gateway (decision
 * 0067, Q14), so a leaver's outside accounts stop acting for the fleet when
 * their access does: every grant of the account in the fleet ends, as every
 * grant ends. Its ships then answer as Q5 until a new owner signs in. Told
 * again, it ends nothing more.
 */
export function createEndAccountGrants(deps: { servers: SignInServers; grants: Pick<PartyGrants, 'ofAccount' | 'remove'>; signIns: Pick<PartySignIns, 'revoke'> }): EndAccountGrants {
  return async ({ fleetId, accountId }) => {
    for (const grant of await deps.grants.ofAccount(fleetId, accountId)) {
      const server = await deps.servers.find(fleetId, grant.party);
      if (server?.client === null || server?.client === undefined) {
        // No client left to revoke with: the grant is only dropped.
        await deps.grants.remove(fleetId, grant);
      } else {
        await endGrant(deps, { client: server.client, grant });
      }
    }
  };
}
