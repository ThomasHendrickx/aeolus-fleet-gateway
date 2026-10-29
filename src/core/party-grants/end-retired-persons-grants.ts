import type { ConnectionStore, FleetDoor } from '../connection/ports.js';
import { endPartyGrant } from './end-grant.js';
import type { PartyGrants, PartySignIns, SignInServers } from './ports.js';

export type EndRetiredPersonsGrants = () => Promise<void>;

/**
 * Use case: one round of the gateway following the persons who hold a grant
 * (decision 0067, Q6), in every fleet it is connected to. Each person ship
 * is read as the gateway's ship on its behalf, as a call's owner is read;
 * every grant of a retired one ends, as every grant ends. What the fleet
 * does not answer now is read again at the next round.
 */
export function createEndRetiredPersonsGrants(deps: {
  connections: Pick<ConnectionStore, 'find'>;
  door: Pick<FleetDoor, 'getShip'>;
  servers: SignInServers;
  grants: Pick<PartyGrants, 'persons' | 'ofPersonShip' | 'remove'>;
  signIns: Pick<PartySignIns, 'revoke'>;
}): EndRetiredPersonsGrants {
  return async () => {
    for (const { fleetId, personShipId } of await deps.grants.persons()) {
      const gateway = await deps.connections.find(fleetId);
      if (gateway === undefined) {
        continue;
      }
      const ship = await deps.door.getShip(gateway.crewToken, { shipId: personShipId, onBehalfOf: personShipId });
      if (ship.isOk && ship.value.status === 'retired') {
        for (const grant of await deps.grants.ofPersonShip(fleetId, personShipId)) {
          await endPartyGrant(deps, grant);
        }
      }
    }
  };
}
