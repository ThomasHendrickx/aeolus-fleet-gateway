import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ActorCredential } from '../actors/credential-of.js';
import type { FleetRefusal } from '../connection/ports.js';
import type { Result } from '../shared/result.js';
import type { SlackApp, SlackAppDescription } from './slack-app.js';
import type { ConfigurationToken, SlackWorkspace } from './slack-workspace.js';

/**
 * Why Slack did not do what the gateway asked: refused, with Slack's own
 * error code (invalid_refresh_token, token_revoked, ...); rate limited, to
 * ask again after Retry-After; or no answer came.
 */
export type SlackRefusal =
  | { readonly kind: 'refused'; readonly error: string }
  | { readonly kind: 'rateLimited'; readonly retryAfterSeconds: number }
  | { readonly kind: 'unavailable'; readonly message: string };

/** What Slack gives for a new app: its id, its credentials and its install screen. */
export interface MadeApp {
  readonly appId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly signingSecret: string;
  readonly installUrl: string;
}

/** What Slack gives for an install: the workspace it went into and the app's bot. */
export interface Install {
  readonly appId: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly botToken: string;
  readonly botUserId: string;
}

/** Outbound port: Slack's app management and install calls, as the gateway makes them. */
export interface SlackTooling {
  /** Spends the refresh token for the next configuration token (tooling.tokens.rotate), naming the workspace it is of. */
  rotateConfigurationToken(refreshToken: string): Promise<Result<{ token: ConfigurationToken; teamId: string }, SlackRefusal>>;
  /** Makes an app from a manifest (apps.manifest.create). */
  makeApp(accessToken: string, description: SlackAppDescription): Promise<Result<MadeApp, SlackRefusal>>;
  /** Gives an app the configuration token made its whole manifest anew, as a rename does (apps.manifest.update). */
  renameApp(accessToken: string, app: { appId: string; description: SlackAppDescription }): Promise<Result<undefined, SlackRefusal>>;
  /** Removes an app the configuration token made (apps.manifest.delete). */
  removeApp(accessToken: string, appId: string): Promise<Result<undefined, SlackRefusal>>;
  /** Turns the code Slack's install screen sent back into the app's bot token (oauth.v2.access). */
  completeInstall(install: { clientId: string; clientSecret: string; code: string; redirectUrl: string }): Promise<Result<Install, SlackRefusal>>;
}

/** Outbound port: each fleet's Slack workspace, in the gateway's vault. */
export interface SlackWorkspaces {
  find(fleetId: FleetId): Promise<SlackWorkspace | undefined>;
  /** Every fleet connected to a workspace whose configuration token Slack has not refused: the ones to rotate. */
  rotatable(): Promise<FleetId[]>;
  save(workspace: SlackWorkspace): Promise<void>;
  /**
   * Runs the change holding the fleet's workspace, and keeps what it
   * answers: one change at a time spends a single-use refresh token. None
   * while the fleet is connected to no workspace.
   */
  change(fleetId: FleetId, change: (workspace: SlackWorkspace) => Promise<SlackWorkspace>): Promise<SlackWorkspace | undefined>;
  /** Forgets the fleet's workspace and every app the gateway made in it. */
  remove(fleetId: FleetId): Promise<void>;
}

/** Outbound port: the Slack apps the gateway made, in its vault. */
export interface SlackApps {
  /** The gateway's own bot in the fleet's workspace, once made. */
  gatewayBot(fleetId: FleetId): Promise<SlackApp | undefined>;
  /** Every app the gateway made in the fleet's workspace. */
  all(fleetId: FleetId): Promise<SlackApp[]>;
  find(fleetId: FleetId, appId: string): Promise<SlackApp | undefined>;
  /** The app by its id alone, as Slack names it in an event; one id is one app across fleets. */
  findByAppId(appId: string): Promise<SlackApp | undefined>;
  /** The bot of the ship, once exposed. */
  ofShip(fleetId: FleetId, shipId: ShipId): Promise<SlackApp | undefined>;
  save(app: SlackApp): Promise<void>;
  remove(fleetId: FleetId, appId: string): Promise<void>;
}

/** What an install's state names: the app it is for, sealed so Slack's redirect can not be forged or replayed past its expiry. */
export interface InstallState {
  readonly fleetId: FleetId;
  readonly appId: string;
  readonly expiresAt: Date;
}

/** Outbound port: seals an install's state into Slack's install address, and opens it again. */
export interface InstallStates {
  seal(state: InstallState): string;
  /** The state a sealed text holds; none for one the gateway did not seal. */
  open(sealed: string): InstallState | undefined;
}

/** Outbound port: a ship's name as the fleet answers it now, read as the gateway's ship; none when the fleet does not answer. */
export interface ShipNames {
  nameOf(fleetId: FleetId, shipId: ShipId): Promise<string | undefined>;
}

/** A ship of the fleet as Slack's part of the gateway reads it: what it is, and its statement's summary (0047), none while it states none. */
export interface ShipToExpose {
  readonly shipId: ShipId;
  readonly name: string;
  readonly kind: 'operator' | 'agent' | 'viewer' | 'person' | 'app' | 'plugin';
  readonly status: 'awaitingCrew' | 'crewed' | 'retired';
  readonly summary: string | null;
}

/** Outbound port: the fleet's ships as Slack's part of the gateway needs them. */
export interface SlackShips {
  /** A ship as the gateway's ship reads it now. */
  read(fleetId: FleetId, shipId: ShipId): Promise<Result<ShipToExpose, FleetRefusal>>;
  /** The ships the actor reads (fleet.list as the actor), within its read reach. */
  list(as: ActorCredential): Promise<Result<Omit<ShipToExpose, 'summary'>[], FleetRefusal>>;
  /** Whether the actor manages the ship now (fleet.checkManage): OK, or the fleet's refusal, which names the ship. */
  checkManage(as: ActorCredential, shipId: ShipId): Promise<Result<undefined, FleetRefusal>>;
}

/** Outbound port: which outside party a ship is the proxy ship of, if any: an outside MCP server's takes tool calls, not a person's words (P-B3). */
export interface ProxyShipKinds {
  kindOf(fleetId: FleetId, shipId: ShipId): Promise<'mcpServer' | 'mcpClient' | 'a2aClient' | 'a2aAgent' | undefined>;
}
