import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { SignInClient } from '../vault/credential.js';
import { endGrant } from './end-grant.js';
import type { PartyGrants, PartySignIns } from './ports.js';

/** How many grants are read at a time while a party's grants end. */
const GRANTS_PER_READ = 100;

export type EndPartyGrants = (party: { fleetId: FleetId; name: string; client: SignInClient }) => Promise<void>;

/**
 * Use case: a party where each person signs in is retired (decision 0067,
 * scenario 31). Every person's grant of it ends, as every grant ends, and
 * the party's client is deleted where the authorization server answered its
 * client configuration endpoint at registration (RFC 7592), so no grant
 * outlives the party there.
 */
export function createEndPartyGrants(deps: { grants: Pick<PartyGrants, 'ofParty' | 'remove'>; signIns: Pick<PartySignIns, 'revoke' | 'deleteClient'> }): EndPartyGrants {
  return async ({ fleetId, name, client }) => {
    let after: ShipId | null = null;
    for (;;) {
      const held = await deps.grants.ofParty(fleetId, { party: name, after, limit: GRANTS_PER_READ });
      for (const grant of held) {
        await endGrant(deps, { client, grant });
      }
      const last = held.at(-1);
      if (last === undefined) {
        break;
      }
      after = last.personShipId;
    }
    const { registrationClientUri, registrationAccessToken } = client;
    if (registrationClientUri !== null && registrationAccessToken !== null) {
      await deps.signIns.deleteClient({ ...client, registrationClientUri, registrationAccessToken });
    }
  };
}
