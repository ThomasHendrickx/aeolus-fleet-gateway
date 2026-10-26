/**
 * A signed-in person's person ship, which the gateway crews for their
 * messaging (decisions 0054, 0057): the fleet's calls it makes as their
 * account, and the one crew every client of the person shares.
 */
import type { DeliveryId, FleetId, MeetingId, MessageId, ShipId, ShipKind } from '@aeolus-fleet/common';

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

/**
 * Outbound port: the lock of each person ship's waiter, held by one gateway
 * instance at a time (wake a person, W9). An instance that loses its hold,
 * as when its connection to the database ends, loses every lock it held.
 */
export interface WaiterLocks {
  /** Takes the ship's lock unless another instance holds it: whether it holds it now. */
  take(ship: PersonShip): Promise<boolean>;
  give(ship: PersonShip): Promise<void>;
  /** Hears each loss of every lock this instance held. */
  onLost(listener: () => void): void;
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
  /** The meeting its message was contributed to or tells of; none outside a meeting (decision 0061). */
  readonly meetingId: MeetingId | null;
}

/** A delivery as the person ship's push receive hands it: with the last number it was handed with under this lease, null while never handed (decision 0040). */
export interface PushedPersonDelivery extends PersonDelivery {
  readonly handOverNumber: number | null;
}

/** What a person ship may send to now, as the fleet's discover answers it: each ship by name, with what it offers, and each type. */
export interface PersonDiscovery {
  readonly ships: readonly { readonly name: string; readonly type: string; readonly kind: ShipKind; readonly statement: DiscoveredStatement }[];
  readonly types: readonly { readonly type: string; readonly reachable: number }[];
}

/** Who a person's message is for: one ship by its name, any ship of a type, or every other participant of a meeting, a contribution (decision 0061). */
export type PersonSelector =
  | { readonly kind: 'ship'; readonly name: string }
  | { readonly kind: 'type'; readonly type: string }
  | { readonly kind: 'meeting'; readonly meetingId: MeetingId };

/** Outbound port: the fleet's calls the gateway makes as the crew of a person ship. */
export interface PersonShipDoor {
  /**
   * How many deliveries wait for the ship: at once, or with a wait while the
   * count is still the one the crew knows, up to the fleet's longest wait
   * (wake a person, W5), or less when told. Stopping the signal ends the wait.
   */
  inbox(crewToken: string, wait?: { knownWaiting: number; signal: AbortSignal; atMostMs?: number }): Promise<Result<{ waiting: number }, FleetRefusal>>;
  /** The ship's deliveries, up to max, its own held ones again first. */
  pushReceive(crewToken: string, take: { max: number }): Promise<Result<PushedPersonDelivery[], FleetRefusal>>;
  /** Acknowledges a delivery the person opened: their own act confirms it (interop 5.1). */
  ack(crewToken: string, deliveryId: DeliveryId): Promise<Result<undefined, FleetRefusal>>;
  /** Reads a delivery the ship acknowledged again, whole, while it is not handled, recording nothing (decision 0040). */
  delivery(crewToken: string, deliveryId: DeliveryId): Promise<Result<PersonDelivery, FleetRefusal>>;
  /** Sends the person's answer to the sender, in reply to its message, once under its key. */
  reply(crewToken: string, reply: { to: ShipId; inReplyTo: MessageId; contentType: string; payload: string; idempotencyKey: string }): Promise<Result<undefined, FleetRefusal>>;
  /** Reports the person dealt with the delivery. */
  handled(crewToken: string, deliveryId: DeliveryId): Promise<Result<undefined, FleetRefusal>>;
  /** Hands the delivery over to the person with its number, naming the channel the wake went through (interop 5.1). */
  handed(crewToken: string, handOver: { deliveryId: DeliveryId; handOverNumber: number; channel: HandOverChannel }): Promise<Result<'handed' | 'acknowledged' | 'undeliverable', FleetRefusal>>;
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

/** The channels a person may turn on to be woken (wake a person, W1), as a hand-over names them. */
export type WakeChannelName = 'email' | 'web-push';

/** What a delivery is handed to the person through: a wake's channel, or a page of theirs in focus, which shows it (W6). */
export type HandOverChannel = WakeChannelName | 'page';

/**
 * Outbound port: one way to wake a person (wake a person, W1, W4): it says
 * only that something waits in the fleet, with the overview's link, and
 * goes out at most once per its window (W3, W10).
 */
export interface WakeChannel {
  readonly name: WakeChannelName;
  /** The least time between two wakes it sends one person ship, from the gateway's configuration (W10). */
  readonly windowMs: number;
  /** Whether the person turned it on (W8): nothing is on by default. */
  isOn(ship: PersonShip): Promise<boolean>;
  /** Sends the wake: whether it went out. A refusal for good (refused) cannot be fixed by trying again; unavailable can succeed later. */
  wake(ship: PersonShip): Promise<Result<undefined, { kind: 'refused' | 'unavailable'; reason: string }>>;
}

/** Outbound port: when each channel last woke each person ship, so the window holds across restarts and instances (W3). */
export interface WakesSent {
  lastSentAt(ship: PersonShip, channel: WakeChannelName): Promise<Date | undefined>;
  record(wake: { ship: PersonShip; channel: WakeChannelName; sentAt: Date }): Promise<void>;
}

/** Outbound port: whether each person turned email on to be woken for their person ship (W8), by fleet and person ship. */
export interface EmailChannels {
  isOn(ship: PersonShip): Promise<boolean>;
  turn(ship: PersonShip, switched: { isOn: boolean; at: Date }): Promise<void>;
}

/** A page of a person in focus (wake a person, W6): by its own id, with when it was last seen in focus. */
export interface FocusedPage {
  readonly fleetId: FleetId;
  readonly shipId: ShipId;
  readonly pageId: string;
  readonly seenAt: Date;
}

/** Outbound port: the pages in focus of every gateway instance, so the waiter of a ship sees them wherever it runs. */
export interface FocusedPages {
  /** Keeps it, or keeps when it was seen anew. */
  save(page: FocusedPage): Promise<void>;
  remove(fleetId: FleetId, pageId: string): Promise<void>;
  /** Whether any page of the person ship's person was seen in focus since then. */
  isAnyInFocus(ship: PersonShip, since: Date): Promise<boolean>;
}

/**
 * A browser a person turned web push on in (wake a person, W8): its push
 * service's endpoint and keys, and the fleet's name its wakes say, as the
 * person's sign-in named it when they turned it on. A subscription its push
 * service said is gone takes no wake again, and the overview says so.
 */
export interface WebPushSubscription {
  readonly fleetId: FleetId;
  readonly shipId: ShipId;
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
  /** The browser, as its person sees it named, such as Firefox on Linux. */
  readonly browser: string;
  readonly fleetName: string;
  readonly addedAt: Date;
  readonly goneAt: Date | null;
}

/** Outbound port: the browsers each person turned web push on in, by fleet, person ship and endpoint. */
export interface WebPushSubscriptions {
  /** The person ship's, oldest added first. */
  list(fleetId: FleetId, shipId: ShipId): Promise<WebPushSubscription[]>;
  /** Keeps it, or keeps it anew when its endpoint was kept before. */
  save(subscription: WebPushSubscription): Promise<void>;
  markGone(fleetId: FleetId, gone: { shipId: ShipId; endpoint: string; goneAt: Date }): Promise<void>;
  remove(fleetId: FleetId, removed: { shipId: ShipId; endpoint: string }): Promise<void>;
}

/** What a wake says (W4): something waits in the fleet, by its name, and the link to the gateway's overview. Nothing else. */
export interface Wake {
  readonly fleetName: string;
  readonly overviewUrl: string;
}

/** How a push service took a wake: sent, gone (it answered 404 or 410: the subscription ended), or failed otherwise. */
export type WebPushSent = 'sent' | 'gone' | 'failed';

/** Outbound port: sends a wake to one browser through its push service. */
export interface WebPush {
  send(subscription: WebPushSubscription, wake: Wake): Promise<WebPushSent>;
}
