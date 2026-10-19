import type { FleetId } from '@aeolus-fleet/common';

import type { PartyStore } from './ports.js';
import { shownPartyOf, type ShownParty } from './shown-party.js';

export type ReadClientParty = (input: { fleetId: FleetId; clientId: string }) => Promise<ShownParty | undefined>;

/** Use case: the party an MCP client is in argo's fleet, as argo reads it, if argo approved it already. */
export function createReadClientParty(deps: { parties: PartyStore }): ReadClientParty {
  return async ({ fleetId, clientId }) => {
    const party = await deps.parties.findByClient(fleetId, clientId);
    return party ? shownPartyOf(party) : undefined;
  };
}
