import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { Result } from '../shared/result.js';
import type { Party, PersonParty } from './party.js';

/** Outbound port: the parties argo approved, one per proxy ship name in a fleet. */
export interface PartyStore {
  find(fleetId: FleetId, name: string): Promise<Party | undefined>;
  list(fleetId: FleetId): Promise<Party[]>;
  /** The party an MCP client is in the fleet, if argo approved it. */
  findByClient(fleetId: FleetId, clientId: string): Promise<Party | undefined>;
  /** The person argo mapped by this email, in lower case. */
  findPersonByEmail(fleetId: FleetId, email: string): Promise<PersonParty | undefined>;
  /** The person bound to this sign-in: the identity provider's issuer and subject. */
  findPersonBySignIn(fleetId: FleetId, signIn: { issuer: string; subject: string }): Promise<PersonParty | undefined>;
  /** Binds a person not bound yet to a sign-in, at most once even under a race: whether this call did. */
  bindPerson(fleetId: FleetId, binding: { name: string; issuer: string; subject: string }): Promise<boolean>;
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
  /** The ship a crew token crews. */
  whoami(crewToken: string): Promise<Result<{ shipId: ShipId; fleetId: FleetId; name: string; type: string }, FleetRefusal>>;
}
