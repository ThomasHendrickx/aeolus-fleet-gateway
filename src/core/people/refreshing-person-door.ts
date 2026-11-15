/** Local claims and acknowledgements change the count without a core wake. Refresh through the lease's serialized looks. */
import type { PersonShipDoor } from './ports.js';

export function createRefreshingPersonDoor(door: PersonShipDoor, request: (crewToken: string) => void): PersonShipDoor {
  return {
    ...door,
    pushReceive: async (crewToken, take) => {
      const taken = await door.pushReceive(crewToken, take);
      if (taken.isOk && taken.value.length > 0) { request(crewToken); }
      return taken;
    },
    ack: async (crewToken, deliveryId) => {
      const acked = await door.ack(crewToken, deliveryId);
      if (acked.isOk) { request(crewToken); }
      return acked;
    },
  };
}
