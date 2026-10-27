import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential, CredentialOf } from '../actors/credential-of.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { SLACK_SCOPE } from './connect-slack.js';
import { gatewayBotOf } from './gateway-bot.js';
import type { InstallStates, SlackApps, SlackShips, SlackTooling, SlackWorkspaces } from './ports.js';
import { managedShipBot } from './ship-bot.js';
import type { SlackApp } from './slack-app.js';
import { slackUnavailableMessage, type TakeAccessToken } from './take-access-token.js';

/** How long an install the gateway started may take to come back. */
export const INSTALL_MS = 10 * 60 * 1000;

export type StartInstallRefusal = DomainError<'SLACK_SCOPE_NOT_HELD' | 'SLACK_NOT_CONNECTED' | 'SLACK_TOKEN_REFUSED' | 'SLACK_UNAVAILABLE' | 'NO_SUCH_BOT' | 'NOT_REACHABLE' | 'FLEET_UNAVAILABLE'>;

/** Install for the gateway's own bot, or with an app id for a ship's bot. */
export type StartInstall = (input: { actor: Actor; as: ActorCredential; fleetName: string; appId?: string }) => Promise<Result<{ url: string }, StartInstallRefusal>>;

/**
 * Use case: an actor holding gateway:slack presses Install (gateway scopes
 * 9.1, 9.2): Slack's install screen for the bot, with the install's state
 * sealed for ten minutes, and the bot waits for its install. For the
 * gateway's bot, one Slack did not make at connect is made first; a ship's
 * bot needs the actor within manage reach of the ship.
 */
export function createStartInstall(deps: {
  slack: Pick<SlackTooling, 'makeApp'>;
  apps: Pick<SlackApps, 'gatewayBot' | 'find' | 'save'>;
  workspaces: Pick<SlackWorkspaces, 'find'>;
  takeAccessToken: TakeAccessToken;
  states: InstallStates;
  ships: Pick<SlackShips, 'read' | 'checkManage'>;
  credentialOf: CredentialOf;
  clock: Clock;
  installRedirectUrl: string;
}): StartInstall {
  return async ({ actor, as, fleetName, appId }) => {
    if (!actor.scopes.includes(SLACK_SCOPE)) {
      return refuse('SLACK_SCOPE_NOT_HELD', `Installing a Slack bot needs ${SLACK_SCOPE}`);
    }
    const { fleetId } = actor;
    if ((await deps.workspaces.find(fleetId)) === undefined) {
      return refuse('SLACK_NOT_CONNECTED', 'The fleet is connected to no Slack workspace');
    }
    let bot: SlackApp | undefined;
    if (appId !== undefined) {
      const shipBot = await managedShipBot(deps, { actor, as, appId });
      if (!shipBot.isOk) {
        return shipBot;
      }
      bot = shipBot.value;
    } else {
      bot = await deps.apps.gatewayBot(fleetId);
    }
    if (bot === undefined) {
      const accessToken = await deps.takeAccessToken(fleetId);
      if (!accessToken.isOk) {
        return accessToken;
      }
      const made = await gatewayBotOf(deps, { fleetId, fleetName, accessToken: accessToken.value });
      if (!made.isOk) {
        return refuse('SLACK_UNAVAILABLE', made.error.kind === 'refused' ? `Slack did not make the gateway's bot (${made.error.error})` : slackUnavailableMessage(made.error));
      }
      bot = made.value;
    }
    const now = deps.clock.now();
    await deps.apps.save({ ...bot, installStartedAt: now });
    const url = new URL(bot.installUrl);
    url.searchParams.set('state', deps.states.seal({ fleetId, appId: bot.appId, expiresAt: new Date(now.getTime() + INSTALL_MS) }));
    return ok({ url: url.toString() });
  };
}
