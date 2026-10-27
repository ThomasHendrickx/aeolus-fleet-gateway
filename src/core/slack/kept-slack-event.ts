import type { DeliveryId, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

/**
 * A linked person's message from Slack, kept by Slack's event id until core
 * stored or refused it (gateway scopes 9.4 step 3, P-B2): the bot's app,
 * the ship it goes to, the person ship it is sent as, where it was written
 * in Slack, and the Markdown it is sent as. An answer in the thread under a
 * posted delivery goes to its sender in reply to its message, and hands the
 * delivery (9.5 step 4). Once core took it, only its event id stays,
 * for an hour, to answer Slack's retries.
 */
export interface KeptSlackEvent {
  readonly fleetId: FleetId;
  readonly eventId: string;
  readonly appId: string;
  readonly shipId: ShipId;
  readonly personShipId: ShipId;
  readonly channel: string;
  readonly ts: string;
  readonly threadTs: string | null;
  readonly markdown: string;
  readonly inReplyTo: MessageId | null;
  /** The delivery the message answers, handled once core stored it. */
  readonly deliveryId: DeliveryId | null;
  readonly receivedAt: Date;
  readonly takenAt: Date | null;
}

/** How long a taken event's id stays, to answer Slack's retries (at most 3, within about 5 minutes). */
export const TAKEN_KEPT_MS = 60 * 60 * 1000;

/** How long an event core has not taken stays before it is deleted and the person told. */
export const UNTAKEN_KEPT_MS = 24 * 60 * 60 * 1000;
