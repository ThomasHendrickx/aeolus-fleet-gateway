import type { ConnectionStore, FleetDoor } from '../connection/ports.js';
import { endPartyGrant } from './end-grant.js';
import type { PartyGrants, PartySignIns, SignInServers } from './ports.js';

/** The fleet's code for a ship it does not find: what a read on behalf of a retired ship answers, as core reads on behalf of live ships only. */
const NO_SUCH_SHIP = 'NOT_FOUND';

export type EndRetiredPersonsGrants = () => Promise<void>;

/**
 * Use case: one round of the gateway following the persons who hold a grant
 * (decision 0067, Q6), in every fleet it is connected to. Each person ship
 * is read as the gateway's ship on its behalf, as a call's owner is read;
 * every grant of a retired one ends, as every grant ends. The fleet answers
 * no such ship on behalf of a retired one, and a person ship is never
 * deleted, so that answer is a retired person ship too. What the fleet
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
      const isRetired = ship.isOk ? ship.value.status === 'retired' : ship.error.code === NO_SUCH_SHIP;
      if (isRetired) {
        for (const grant of await deps.grants.ofPersonShip(fleetId, personShipId)) {
          await endPartyGrant(deps, grant);
        }
      }
    }
  };
}
