import type { FleetId, ShipId } from '@aeolus-fleet/common';

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
  save(app: SlackApp): Promise<void>;
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
