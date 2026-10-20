import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ActorCredential } from '../actors/credential-of.js';
import type { FleetRefusal } from '../connection/ports.js';
import type { Result } from '../shared/result.js';
import type { Party } from './party.js';

/** Outbound port: the parties argo approved, one per proxy ship name in a fleet. */
export interface PartyStore {
  find(fleetId: FleetId, name: string): Promise<Party | undefined>;
  list(fleetId: FleetId): Promise<Party[]>;
  /** The party an MCP client is in the fleet, if argo approved it. */
  findByClient(fleetId: FleetId, clientId: string): Promise<Party | undefined>;
  save(party: Party): Promise<void>;
  remove(fleetId: FleetId, name: string): Promise<void>;
}

/** Outbound port: the fleet's calls the gateway makes for a party's proxy ship. */
export interface ProxyShipDoor {
  /**
   * Commissions an app ship as the gateway's ship (fleet:commission and
   * fleet:on-behalf, decision 0044), owned by the owner argo picked (0045),
   * with the scopes granted, only ones the gateway's ship holds (0053),
   * under the gateway's idempotency key: its id, and on the first commission
   * its secret. A repeat under the same key answers the same ship without one.
   */
  commissionAppShip(
    crewToken: string,
    ship: { name: string; type: string; owner: ShipId; idempotencyKey: string; scopes: readonly string[] },
  ): Promise<Result<{ shipId: ShipId; secret: string | null }, FleetRefusal>>;
  register(claim: { shipId: ShipId; secret: string }): Promise<Result<{ crewToken: string }, FleetRefusal>>;
}

/** Outbound port: the fleet's calls on a party's proxy ship made as the actor (decision 0057), so the fleet checks its scopes and reach. */
export interface ProxyShipsAsActor {
  /** Retires the proxy ship (fleet.retire); a ship retired already is refused with CONFLICT. */
  retire(as: ActorCredential, ship: { shipId: ShipId }): Promise<Result<undefined, FleetRefusal>>;
}

/** Outbound port: what the fleet holds for a proxy ship, read as the gateway's ship (fleet:read). */
export interface ProxyShipReads {
  read(crewToken: string, ship: { shipId: ShipId }): Promise<Result<{ ownerShipId: ShipId | null; scopes: string[] }, FleetRefusal>>;
}
