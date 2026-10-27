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
  /** The bot's name in Slack, as the gateway last made or renamed it: the ship's name then, or the fleet's for its own bot. */
  readonly name: string;
  readonly madeAt: Date;
  /** When someone last opened Slack's install screen for it from the gateway, while no install came back. */
  readonly installStartedAt: Date | null;
  readonly bot: { readonly token: string; readonly userId: string } | null;
  /** When Slack said the app was uninstalled or its tokens revoked (app_uninstalled, tokens_revoked). */
  readonly removedInSlackAt: Date | null;
}

/** A bot's state on the Slack page (gateway scopes 9.2). */
export type BotState = 'made' | 'waitingForInstall' | 'inSlack' | 'removedInSlack';

export function botStateOf(app: SlackApp): BotState {
  if (app.removedInSlackAt !== null) {
    return 'removedInSlack';
  }
  if (app.bot !== null) {
    return 'inSlack';
  }
  return app.installStartedAt === null ? 'made' : 'waitingForInstall';
}

/** What the gateway asks Slack to make: the app's name and description, its bot's scopes, the user scopes Sign in with Slack asks, where Slack sends an install or a sign-in back, and the events it sends the gateway and where. */
export interface SlackAppDescription {
  readonly name: string;
  readonly description: string;
  readonly botScopes: readonly string[];
  readonly userScopes: readonly string[];
  /** Where Slack sends an install back first, then any other address Slack may send the person back to. */
  readonly redirectUrls: readonly string[];
  readonly events: { readonly url: string; readonly botEvents: readonly string[] } | null;
}

/** The gateway's addresses Slack calls: where an install comes back, where events go, and where Sign in with Slack comes back to link. */
export interface SlackAddresses {
  readonly installRedirectUrl: string;
  readonly eventsUrl: string;
  readonly linkRedirectUrl: string;
}

/** Sign in with Slack's user scopes (OpenID Connect): who signed in, in which workspace, and their name. */
export const SIGN_IN_SCOPES = ['openid', 'profile'];

/** Slack's longest app name. */
export const APP_NAME_MAX_LENGTH = 35;

/** Slack's longest app description. */
export const APP_DESCRIPTION_MAX_LENGTH = 140;

/**
 * The gateway's own bot (B5), named after the fleet: it shows a person what
 * waits for their person ship, in a direct message. A person links their
 * Slack account through its Sign in with Slack (gateway scopes 9.3).
 */
export function gatewayBotDescription(fleetName: string, addresses: Pick<SlackAddresses, 'installRedirectUrl' | 'linkRedirectUrl'>): SlackAppDescription {
  return {
    name: fleetName.slice(0, APP_NAME_MAX_LENGTH),
    description: `What waits for you in the ${fleetName} fleet of Aeolus`.slice(0, APP_DESCRIPTION_MAX_LENGTH),
    botScopes: ['chat:write', 'im:history', 'im:write'],
    userScopes: SIGN_IN_SCOPES,
    redirectUrls: [addresses.installRedirectUrl, addresses.linkRedirectUrl],
    events: null,
  };
}

/**
 * A ship's own bot (gateway scopes 9.2): the ship's name, its statement's
 * summary as the description (0047), a direct messages tab, the events of a
 * direct message and a mention, and the bot scopes to read them, post and
 * react. Slack sends its uninstall and revoked tokens too.
 */
export function shipBotDescription(ship: { name: string; summary: string | null }, addresses: Pick<SlackAddresses, 'installRedirectUrl' | 'eventsUrl'>): SlackAppDescription {
  return {
    name: ship.name.slice(0, APP_NAME_MAX_LENGTH),
    description: (ship.summary ?? `The ${ship.name} ship of Aeolus`).slice(0, APP_DESCRIPTION_MAX_LENGTH),
    botScopes: ['chat:write', 'im:history', 'app_mentions:read', 'reactions:write'],
    userScopes: [],
    redirectUrls: [addresses.installRedirectUrl],
    events: { url: addresses.eventsUrl, botEvents: ['message.im', 'app_mention', 'app_uninstalled', 'tokens_revoked'] },
  };
}
