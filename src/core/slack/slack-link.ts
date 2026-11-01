import type { FleetId, ShipId } from '@aeolus-fleet/common';

/**
 * A person's Slack account linked to their account in a fleet (gateway
 * scopes 9.3), kept by the fleet, the Slack workspace and user, and the
 * person ship their messages are: one Slack user to one account per fleet,
 * one Slack user per account. A disabled account's link stops (0055).
 */
export interface SlackLink {
  readonly fleetId: FleetId;
  readonly teamId: string;
  readonly slackUserId: string;
  /** The person's name in Slack as Sign in with Slack gave it. */
  readonly slackName: string;
  readonly accountId: string;
  readonly personShipId: ShipId;
  readonly linkedAt: Date;
  readonly stoppedAt: Date | null;
}
