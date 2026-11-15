/** Local claims notify every instance, so the lock holder refreshes the shared person lease count. */
import type { InboxChange, InboxChanges, PersonCrews, PersonShipDoor } from './ports.js';

export function createPersonInboxWakes(deps: {
  crews: PersonCrews;
  changes: InboxChanges;
  whoami: PersonShipDoor['whoami'];
  request: (crewToken: string) => void;
}): { changed: (crewToken: string) => Promise<void>; told: (ship: InboxChange) => Promise<void> } {
  return {
    changed: async (crewToken) => {
      deps.request(crewToken);
      const who = await deps.whoami(crewToken);
      if (who.isOk) { await deps.changes.tell({ fleetId: who.value.fleetId, shipId: who.value.shipId }); }
    },
    told: async (ship) => {
      const crew = await deps.crews.find(ship.fleetId, ship.shipId);
      if (crew !== undefined) { deps.request(crew.crewToken); }
    },
  };
}
