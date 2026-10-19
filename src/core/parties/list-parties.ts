import type { FleetId } from '@aeolus-fleet/common';

import { shownPartyOf, type ShownParty } from './shown-party.js';
import type { PartyStore } from './ports.js';

export type ListParties = (fleetId: FleetId) => Promise<ShownParty[]>;

/** Use case: the parties argo approved for its fleet, by name, as argo reads them: never a credential or a crew token. */
export function createListParties(deps: { parties: PartyStore }): ListParties {
  return async (fleetId) =>
    (await deps.parties.list(fleetId))
      .map(shownPartyOf)
      .sort((left, right) => left.name.localeCompare(right.name));
}
