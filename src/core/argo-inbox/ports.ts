/**
 * argo's inbox, read by the gateway's own ship for the people who may act as
 * argo (aeolus-fleet docs/design/argo-inbox, AI1 and AI9): the accounts
 * allowed as argo, and what the gateway reads of argo's inbox.
 */
import type { DeliveryId, DeliveryState, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { Result } from '../shared/result.js';
import type { ArgoSlackPost } from './argo-slack-post.js';

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

/** A message to argo as the gateway reads it from argo's inbox: who sent what, when, and its delivery. */
export interface ArgoMessage {
  readonly messageId: MessageId;
  readonly deliveryId: DeliveryId;
  readonly sender: { readonly shipId: ShipId; readonly name: string };
  readonly contentType: string;
  readonly sentAt: Date;
}

/** A message to argo and its delivery's state as the fleet answers it. */
export interface ArgoInboxEntry extends ArgoMessage {
  readonly deliveryState: DeliveryState;
}

/** A message to argo read whole: its entry, and its headline, as a person reads it first. */
export interface ArgoMessageRead extends ArgoInboxEntry {
  /** A question's or a step's title, an alert's or a notice's headline, or else the payload's first line (#1570). */
  readonly headline: string;
}

/** A change to a delivery to argo, as the fleet's event says it: the message, when, and the account that made it, as argo or itself; none for a ship's or the system's. */
export interface ArgoInboxChange {
  readonly messageId: MessageId;
  readonly at: Date;
  readonly accountId: string | null;
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
  /** Every message to argo, with its delivery's state. */
  entries(crewToken: string, argo: ShipId): Promise<Result<readonly ArgoInboxEntry[], FleetRefusal>>;
  /** One message to argo with its delivery's state; null when it is no message to argo the ship reads. */
  entry(crewToken: string, read: { argo: ShipId; messageId: MessageId }): Promise<Result<ArgoMessageRead | null, FleetRefusal>>;
  /** A ship's type, as the fleet answers it even of a ship outside the read reach. */
  shipType(crewToken: string, shipId: ShipId): Promise<Result<string, FleetRefusal>>;
  /** Each change to a delivery to argo after the position, in order, waiting while none came until the signal aborts, and the position to follow from next. */
  changes(crewToken: string, follow: { argo: ShipId; afterSeq: number; signal: AbortSignal }): Promise<Result<{ changes: readonly ArgoInboxChange[]; lastSeq: number }, FleetRefusal>>;
}

/** Outbound port: the messages open at argo in Slack, by fleet, person ship and message, in the gateway's database. */
export interface ArgoSlackPosts {
  /** Every post kept in the fleet. */
  list(fleetId: FleetId): Promise<ArgoSlackPost[]>;
  /** Keeps a new post; none when one is kept for the person ship and the message already, as two rounds at once find. */
  keep(post: ArgoSlackPost): Promise<'kept' | 'known'>;
  /** Keeps it as it is now: given its Slack message, or given up. */
  save(post: ArgoSlackPost): Promise<void>;
  remove(fleetId: FleetId, post: { personShipId: ShipId; messageId: MessageId }): Promise<void>;
}
