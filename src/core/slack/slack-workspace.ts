import type { FleetId, ShipId } from '@aeolus-fleet/common';

/**
 * Slack's app configuration token (gateway scopes 9.1): an access token that
 * makes and removes apps, for 12 hours, and a single-use refresh token that
 * turns into the next pair. It belongs to the Slack user who issued it, and
 * changes only the apps it made.
 */
export interface ConfigurationToken {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: Date;
}

/** How long before its access token ends the gateway rotates a configuration token, so a pass that runs late still finds it fresh. */
export const ROTATION_MARGIN_MS = 60 * 60 * 1000;

/** Whether the access token works for at least the rotation margin from now; else the gateway rotates it first. */
export function isFresh(token: ConfigurationToken, now: Date): boolean {
  return token.expiresAt.getTime() - now.getTime() > ROTATION_MARGIN_MS;
}

/**
 * A fleet's Slack workspace, connected by an actor holding gateway:slack
 * (one workspace per fleet; a workspace may serve several fleets, P-B4).
 * Its name is known once Slack named it, at the gateway's bot's install.
 * A refused configuration token stays refused until someone connects again:
 * bots already installed keep working on their own bot tokens.
 */
export interface SlackWorkspace {
  readonly fleetId: FleetId;
  readonly teamId: string;
  readonly teamName: string | null;
  /** The person ship of the account that connected it, by its name then. */
  readonly connectedBy: { readonly shipId: ShipId; readonly name: string };
  readonly connectedAt: Date;
  readonly token: ConfigurationToken;
  readonly isTokenRefused: boolean;
}
