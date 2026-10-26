import type { DeliveryId, FleetId, ShipId } from '@aeolus-fleet/common';

import type { Result } from '../shared/result.js';

/**
 * Why the fleet refused a ship call: its code (CONFLICT, UNAUTHORIZED,
 * LEASE_ENDED, ...) and its message. UNAVAILABLE: no answer came, so the call
 * may or may not have been carried out.
 */
export interface FleetRefusal {
  code: string;
  message: string;
}

/** A ship as `fleet.ship` shows it: what the gateway reads of it. */
export interface FleetShip {
  status: 'awaitingCrew' | 'crewed' | 'retired';
  name: string;
  scopes: string[];
}

/**
 * Outbound port: the fleet's public ship calls, as the gateway makes them for
 * its own ship. The gateway is a ship like any other.
 */
/** A scope the fleet lists (fleet.scopes): core's, a plugin's or the fleet's own, with its one-line description. */
export interface ListedScope {
  scope: string;
  description: string;
}

export interface FleetDoor {
  register(claim: { shipId: ShipId; secret: string }): Promise<Result<{ crewToken: string }, FleetRefusal>>;
  whoami(crewToken: string): Promise<Result<{ shipId: ShipId; fleetId: FleetId; name: string; type: string }, FleetRefusal>>;
  /**
   * A ship of the fleet, retired ones included; needs fleet:read. Read on
   * behalf of a ship (fleet:on-behalf), it answers within that ship's read
   * reach; outside the reader's read reach it is refused.
   */
  getShip(crewToken: string, ship: { shipId: ShipId; onBehalfOf?: ShipId }): Promise<Result<FleetShip, FleetRefusal>>;
  /** Ends this session's crew of its ship: the lease and the secret it claimed with. */
  deregister(crewToken: string): Promise<Result<undefined, FleetRefusal>>;
  /** Every scope the fleet lists (fleet.scopes, fleet:read): core's, each plugin's and the fleet's own. */
  listScopes(crewToken: string): Promise<Result<ListedScope[], FleetRefusal>>;
  /** Declares the ship's own namespace and its whole list of scopes; the fleet stores them, the gateway enforces them (decision 0046). */
  declareScopes(crewToken: string, declaration: { namespace: string; scopes: { scope: string; description: string }[] }): Promise<Result<undefined, FleetRefusal>>;
}

/** A delivery to the gateway's own ship: what tells a ping apart, and who sent it. */
export interface GatewayDelivery {
  deliveryId: DeliveryId;
  contentType: string;
  senderShipId: ShipId;
}

/** Outbound port: the deliveries to the gateway's own ship, as its crew takes, acks and pongs them. */
export interface GatewayInbox {
  /** Takes up to max deliveries for the ship, waiting while the fleet waits for one, until the signal aborts; none when none came. */
  receive(crewToken: string, take: { max: number; signal: AbortSignal }): Promise<Result<GatewayDelivery[], FleetRefusal>>;
  ack(crewToken: string, deliveryId: DeliveryId): Promise<Result<undefined, FleetRefusal>>;
  /** Answers argo's ping, in place of the ack. */
  pong(crewToken: string, deliveryId: DeliveryId): Promise<Result<undefined, FleetRefusal>>;
}

/** The crew token the gateway holds for its ship in a fleet, and when it got it. */
export interface GatewayCrew {
  /** The fleet the ship belongs to: the fleet the gateway serves. */
  fleetId: FleetId;
  shipId: ShipId;
  /** The ship's name when the gateway connected, shown while the fleet does not answer. */
  name: string;
  crewToken: string;
  crewedAt: Date;
}

/** The fleet and ship the gateway was last connected as; kept when its crew token is dropped. */
export interface GatewayBinding {
  fleetId: FleetId;
  shipId: ShipId;
}

/**
 * Outbound port: where the gateway keeps each fleet's crew token across
 * restarts. One install serves many fleets, one connection each.
 */
export interface ConnectionStore {
  /** The fleet's crew, while the gateway holds a crew token for it: while it is connected to that fleet. */
  find(fleetId: FleetId): Promise<GatewayCrew | undefined>;
  /** The fleet's last connection, with or without a crew token; none before its first. */
  binding(fleetId: FleetId): Promise<GatewayBinding | undefined>;
  /** Every fleet's crew the gateway holds a crew token for: the fleets it is connected to. */
  connected(): Promise<GatewayCrew[]>;
  save(crew: GatewayCrew): Promise<void>;
  /** Forgets the fleet's crew token, keeping its binding: the gateway is not connected to that fleet. */
  drop(fleetId: FleetId): Promise<void>;
}

/** Whether the gateway holds a working crew token for its ship, as which ship, and the ship it was last connected as. */
export interface ConnectionStatus {
  state: 'not-connected' | 'connected';
  ship: { shipId: ShipId; name: string } | null;
  lastShipId: ShipId | null;
}
