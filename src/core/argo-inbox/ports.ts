/**
 * argo's inbox, read by the gateway's own ship for the people who may act as
 * argo (aeolus-fleet docs/design/argo-inbox, AI1 and AI9): the accounts
 * allowed as argo, and what the gateway reads of argo's inbox.
 */
import type { DeliveryId, DeliveryState, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
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
  entry(crewToken: string, read: { argo: ShipId; messageId: MessageId }): Promise<Result<ArgoInboxEntry | null, FleetRefusal>>;
  /** The messages whose delivery to argo changed after the position, waiting while none did until the signal aborts, and the position to follow from next. */
  changes(crewToken: string, follow: { argo: ShipId; afterSeq: number; signal: AbortSignal }): Promise<Result<{ messageIds: readonly MessageId[]; lastSeq: number }, FleetRefusal>>;
}
