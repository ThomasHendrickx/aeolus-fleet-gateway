/**
 * A signed-in person's person ship, which the gateway crews for their
 * messaging (decisions 0054, 0057): the fleet's calls it makes as their
 * account, and the one crew every client of the person shares.
 */
import type { DeliveryId, FleetId, MessageId, ShipId, ShipKind } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { DiscoveredStatement } from '../mcp-in/ports.js';
import type { Result } from '../shared/result.js';

/** A call the gateway makes for an account: the account's token beside the gateway's own crew token, so the account acts through the gateway's ship. */
export interface AccountCall {
  readonly crewToken: string;
  readonly accountToken: string;
  readonly shipId: ShipId;
}

/** Outbound port: the fleet's calls for an account's own person ship (aeolus-fleet #990). */
export interface AccountDoor {
  /** A new starting prompt for the ship while it awaits crew: its secret. */
  startingPrompt(call: AccountCall): Promise<Result<{ secret: string }, FleetRefusal>>;
  /** Frees the ship from the crew that has it, so it can be crewed again. */
  release(call: AccountCall): Promise<Result<undefined, FleetRefusal>>;
}

/** The crew token the gateway holds for a person ship: one crew, shared by every client of its person. */
export interface PersonCrew {
  readonly fleetId: FleetId;
  readonly shipId: ShipId;
  readonly crewToken: string;
  readonly crewedAt: Date;
}

/** A person ship, by its fleet and id. */
export interface PersonShip {
  readonly fleetId: FleetId;
  readonly shipId: ShipId;
}

export interface PersonCrews {
  /** The person ships it holds a crew for, of every fleet, by fleet and ship, after the one given (wake a person, W7). */
  crewed(page: { after: PersonShip | null; limit: number }): Promise<PersonShip[]>;
  find(fleetId: FleetId, shipId: ShipId): Promise<PersonCrew | undefined>;
  save(crew: PersonCrew): Promise<void>;
  /** Forgets a crew that no longer works, as when its lease ended, so the ship is crewed again. */
  drop(fleetId: FleetId, shipId: ShipId): Promise<void>;
}

/** A change to a person ship's inbox: its pages read it again (wake a person, #1014). */
export interface InboxChange {
  readonly fleetId: FleetId;
  readonly shipId: ShipId;
}

/** Outbound port: tells every gateway instance that a person ship's inbox changed, carrying nothing of it. */
export interface InboxChanges {
  tell(change: InboxChange): Promise<void>;
}

/** A delivery to the person ship, as the fleet's push receive hands it. */
export interface PersonDelivery {
  readonly deliveryId: DeliveryId;
  readonly messageId: MessageId;
  readonly senderShipId: ShipId;
  readonly senderName: string;
  readonly contentType: string;
  readonly payload: string;
  /** The title of a question (the question content type), read at the edge; none for any other message. */
  readonly questionTitle: string | null;
  readonly sentAt: Date;
  readonly inReplyTo: MessageId | null;
}

/** What a person ship may send to now, as the fleet's discover answers it: each ship by name, with what it offers, and each type. */
export interface PersonDiscovery {
  readonly ships: readonly { readonly name: string; readonly type: string; readonly kind: ShipKind; readonly statement: DiscoveredStatement }[];
  readonly types: readonly { readonly type: string; readonly reachable: number }[];
}

/** Who a person's message is for: one ship by its name, or any ship of a type. */
export type PersonSelector = { readonly kind: 'ship'; readonly name: string } | { readonly kind: 'type'; readonly type: string };

/** Outbound port: the fleet's calls the gateway makes as the crew of a person ship. */
export interface PersonShipDoor {
  /**
   * How many deliveries wait for the ship: at once, or with a wait while the
   * count is still the one the crew knows, up to the fleet's longest wait
   * (wake a person, W5). Stopping the signal ends the wait.
   */
  inbox(crewToken: string, wait?: { knownWaiting: number; signal: AbortSignal }): Promise<Result<{ waiting: number }, FleetRefusal>>;
  /** The ship's deliveries, up to max, its own held ones again first. */
  pushReceive(crewToken: string, take: { max: number }): Promise<Result<PersonDelivery[], FleetRefusal>>;
  /** Acknowledges a delivery the person opened: their own act confirms it (interop 5.1). */
  ack(crewToken: string, deliveryId: DeliveryId): Promise<Result<undefined, FleetRefusal>>;
  /** Reads a delivery the ship acknowledged again, whole, while it is not handled, recording nothing (decision 0040). */
  delivery(crewToken: string, deliveryId: DeliveryId): Promise<Result<PersonDelivery, FleetRefusal>>;
  /** Sends the person's answer to the sender, in reply to its message, once under its key. */
  reply(crewToken: string, reply: { to: ShipId; inReplyTo: MessageId; contentType: string; payload: string; idempotencyKey: string }): Promise<Result<undefined, FleetRefusal>>;
  /** Reports the person dealt with the delivery. */
  handled(crewToken: string, deliveryId: DeliveryId): Promise<Result<undefined, FleetRefusal>>;
  /** The ships and types the ship may send to now: the fleet checks its scopes and the network rules. */
  discover(crewToken: string): Promise<Result<PersonDiscovery, FleetRefusal>>;
  /** Sends the person's own message, once under its key. */
  send(crewToken: string, message: { to: PersonSelector; contentType: string; payload: string; idempotencyKey: string }): Promise<Result<{ messageId: MessageId }, FleetRefusal>>;
}

/**
 * A delivery a person opened, as the gateway keeps it until they deal with
 * it (Q28 (a)): what their answer needs once the delivery is acknowledged,
 * its message and sender, and what their inbox lists, its title and when it
 * was sent, never its payload. It is the person ship's, so every client of
 * the person finds it.
 */
export interface OpenedDelivery {
  readonly fleetId: FleetId;
  readonly shipId: ShipId;
  readonly deliveryId: DeliveryId;
  readonly messageId: MessageId;
  readonly senderShipId: ShipId;
  readonly from: string;
  readonly title: string;
  readonly sentAt: Date;
  readonly openedAt: Date;
}

/** Outbound port: the deliveries people opened, by fleet, person ship and delivery. */
export interface OpenedDeliveries {
  /** Keeps it, or keeps it as last opened when it was opened before. */
  save(opened: OpenedDelivery): Promise<void>;
  find(fleetId: FleetId, opened: { shipId: ShipId; deliveryId: string }): Promise<OpenedDelivery | undefined>;
  /** The person ship's, oldest opened first. */
  list(fleetId: FleetId, shipId: ShipId): Promise<OpenedDelivery[]>;
  /** Forgets it once the person dealt with it. */
  remove(fleetId: FleetId, opened: { shipId: ShipId; deliveryId: string }): Promise<void>;
}
