import type { FleetId, ShipId } from '@aeolus-fleet/common';

/**
 * A linked person's message from Slack, kept by Slack's event id until core
 * stored or refused it (gateway scopes 9.4 step 3, P-B2): the bot's app and
 * ship, the person ship it is sent as, where it was written in Slack, and
 * the Markdown it is sent as. Once core took it, only its event id stays,
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
  readonly receivedAt: Date;
  readonly takenAt: Date | null;
}

/** How long a taken event's id stays, to answer Slack's retries (at most 3, within about 5 minutes). */
export const TAKEN_KEPT_MS = 60 * 60 * 1000;

/** How long an event core has not taken stays before it is deleted and the person told. */
export const UNTAKEN_KEPT_MS = 24 * 60 * 60 * 1000;
