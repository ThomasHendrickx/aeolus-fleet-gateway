/**
 * argo's inbox, read by the gateway's own ship for the people who may act as
 * argo (aeolus-fleet docs/design/argo-inbox, AI1 and AI9): the accounts
 * allowed as argo, and what the gateway reads of argo's inbox.
 */
import type { DeliveryId, DeliveryState, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { PersonShip, WakeChannelName } from '../people/person-wakes.js';
import type { Result } from '../shared/result.js';

/** An account allowed as argo in a fleet, as its latest account token said, and the person ship it is reached at. */
export interface ArgoAccount {
  readonly accountId: string;
  readonly personShipId: ShipId;
}

/** Outbound port: each fleet's accounts allowed as argo, from each account's latest account token. */
export interface ArgoAccounts {
  keep(fleetId: FleetId, account: ArgoAccount): Promise<void>;
  drop(fleetId: FleetId, accountId: string): Promise<void>;
  list(fleetId: FleetId): Promise<readonly ArgoAccount[]>;
}

/** A message to argo as the fleet lists it: who sent it, when, and its delivery, with the delivery's state. */
export interface ArgoInboxListed {
  readonly messageId: MessageId;
  readonly deliveryId: DeliveryId;
  readonly sender: { readonly shipId: ShipId; readonly name: string };
  readonly contentType: string;
  readonly sentAt: Date;
  readonly deliveryState: DeliveryState;
}

/** A message to argo read whole: listed, with its payload, its headline, and the question it asks or withdraws, read from it. */
export interface ArgoInboxEntry extends ArgoInboxListed {
  readonly payload: string;
  /** A question's title, or a step's, an alert's or a notice's headline; none for any other message. */
  readonly headline: string | null;
  readonly askedQuestionId: string | null;
  readonly withdrawnQuestionId: string | null;
}

/** A message to argo as the gateway holds it: listed, titled as an inbox lists it, and the question it asks or withdraws. */
export interface ArgoMessage extends Omit<ArgoInboxListed, 'deliveryState'> {
  readonly title: string;
  readonly askedQuestionId: string | null;
  readonly withdrawnQuestionId: string | null;
}

/** A change to a delivery to argo, as the fleet's event says it: when, and who caused it, the account signed in to the console as argo included (decision 0054). */
export interface ArgoInboxChange {
  readonly messageId: MessageId;
  readonly occurredAt: Date;
  /** The ship that caused it; none for any other actor. */
  readonly actorShipId: ShipId | null;
  /** The account signed in to the console as argo when argo caused it; none otherwise. */
  readonly signedInAccountId: string | null;
}

/**
 * Outbound port: what the gateway's own ship reads of argo's inbox, by its
 * crew token, within its read reach (decision 0034): nothing of argo's
 * outside it.
 */
export interface ArgoInboxDoor {
  /** argo's ship, when it is in the ship's read reach; null while argo has not let it read. */
  argoInReach(crewToken: string): Promise<Result<ShipId | null, FleetRefusal>>;
  /** The position of the fleet's last event: a follow from there misses nothing after it. */
  position(crewToken: string): Promise<Result<number, FleetRefusal>>;
  /** Every message to argo, listed with its delivery's state. */
  entries(crewToken: string, argo: ShipId): Promise<Result<readonly ArgoInboxListed[], FleetRefusal>>;
  /** One message to argo read whole, with its delivery's state; null when it is no message to argo the ship reads. */
  entry(crewToken: string, read: { argo: ShipId; messageId: MessageId }): Promise<Result<ArgoInboxEntry | null, FleetRefusal>>;
  /** Each change to a delivery to argo after the position, oldest first, waiting while none came until the signal aborts, and the position to follow from next. */
  changes(crewToken: string, follow: { argo: ShipId; afterSeq: number; signal: AbortSignal }): Promise<Result<{ changes: readonly ArgoInboxChange[]; lastSeq: number }, FleetRefusal>>;
}

/**
 * Outbound port: argo's wakes of each person ship, apart from its own (argo's
 * inbox, AI4, AI5): the messages to argo a wake or a page in focus already
 * covered, so each is woken once per person, and when each channel last woke
 * the person ship for argo, so the window holds across restarts and instances.
 * Each read and write names the messages it concerns, so it reads in pages of
 * those, never every message covered.
 */
export interface ArgoWakes {
  /** Which of these messages were covered for the person ship. */
  coveredAmong(ship: PersonShip, messageIds: readonly MessageId[]): Promise<ReadonlySet<MessageId>>;
  cover(ship: PersonShip, messageIds: readonly MessageId[]): Promise<void>;
  /** Forgets these messages, done at argo: they never open again. */
  forget(ship: PersonShip, messageIds: readonly MessageId[]): Promise<void>;
  /** Forgets every covered message but the ones open now, as at a start, when what was done meanwhile is not known. */
  forgetAllBut(ship: PersonShip, open: readonly MessageId[]): Promise<void>;
  lastSentAt(ship: PersonShip, channel: WakeChannelName): Promise<Date | undefined>;
  record(wake: { ship: PersonShip; channel: WakeChannelName; sentAt: Date }): Promise<void>;
}
