import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { Result } from '../shared/result.js';
import type { Party } from './party.js';

/** Outbound port: the parties argo approved, one per proxy ship name in a fleet. */
export interface PartyStore {
  find(fleetId: FleetId, name: string): Promise<Party | undefined>;
  list(fleetId: FleetId): Promise<Party[]>;
  save(party: Party): Promise<void>;
  remove(fleetId: FleetId, name: string): Promise<void>;
}

/** Outbound port: the fleet's calls the gateway makes for a party's proxy ship. */
export interface ProxyShipDoor {
  /**
   * Commissions an app ship as the gateway's ship (fleet:commission and
   * fleet:on-behalf, decision 0044), owned by the owner argo picked (0045),
   * under the gateway's idempotency key: its id, and on the first commission
   * its secret. A repeat under the same key answers the same ship without one.
   */
  commissionAppShip(
    crewToken: string,
    ship: { name: string; type: string; owner: ShipId; idempotencyKey: string },
  ): Promise<Result<{ shipId: ShipId; secret: string | null }, FleetRefusal>>;
  register(claim: { shipId: ShipId; secret: string }): Promise<Result<{ crewToken: string }, FleetRefusal>>;
}
