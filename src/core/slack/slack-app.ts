import type { FleetId, ShipId } from '@aeolus-fleet/common';

/**
 * A Slack app the gateway made from a manifest in a fleet's workspace, kept
 * with what Slack gave for it: its client credentials and signing secret
 * when made, its bot token once installed. The gateway's own bot is the
 * fleet's first (B5).
 */
export interface SlackApp {
  readonly fleetId: FleetId;
  readonly appId: string;
  /** The ship the app is the bot of; null for the gateway's own bot. */
  readonly shipId: ShipId | null;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly signingSecret: string;
  /** Slack's install screen for the app. */
  readonly installUrl: string;
  readonly madeAt: Date;
  readonly bot: { readonly token: string; readonly userId: string } | null;
}

/** What the gateway asks Slack to make: the app's name and description, its bot's scopes, and where Slack sends an install back. */
export interface SlackAppDescription {
  readonly name: string;
  readonly description: string;
  readonly botScopes: readonly string[];
  readonly redirectUrl: string;
}

/** Slack's longest app name. */
export const APP_NAME_MAX_LENGTH = 35;

/** Slack's longest app description. */
export const APP_DESCRIPTION_MAX_LENGTH = 140;

/**
 * The gateway's own bot (B5), named after the fleet: it shows a person what
 * waits for their person ship, in a direct message.
 */
export function gatewayBotDescription(fleetName: string, redirectUrl: string): SlackAppDescription {
  return {
    name: fleetName.slice(0, APP_NAME_MAX_LENGTH),
    description: `What waits for you in the ${fleetName} fleet of Aeolus`.slice(0, APP_DESCRIPTION_MAX_LENGTH),
    botScopes: ['chat:write', 'im:history', 'im:write'],
    redirectUrl,
  };
}
