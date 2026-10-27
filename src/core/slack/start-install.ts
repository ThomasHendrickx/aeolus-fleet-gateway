import type { Actor } from '../actors/authenticate-actor.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { SLACK_SCOPE } from './connect-slack.js';
import { gatewayBotOf } from './gateway-bot.js';
import type { InstallStates, SlackApps, SlackTooling, SlackWorkspaces } from './ports.js';
import { slackUnavailableMessage, type TakeAccessToken } from './take-access-token.js';

/** How long an install the gateway started may take to come back. */
export const INSTALL_MS = 10 * 60 * 1000;

export type StartInstallRefusal = DomainError<'SLACK_SCOPE_NOT_HELD' | 'SLACK_NOT_CONNECTED' | 'SLACK_TOKEN_REFUSED' | 'SLACK_UNAVAILABLE'>;

export type StartInstall = (input: { actor: Actor; fleetName: string }) => Promise<Result<{ url: string }, StartInstallRefusal>>;

/**
 * Use case: an actor holding gateway:slack presses Install for the
 * gateway's bot (gateway scopes 9.1): Slack's install screen for it, with
 * the install's state sealed for ten minutes. A bot Slack did not make at
 * connect is made first.
 */
export function createStartInstall(deps: {
  slack: Pick<SlackTooling, 'makeApp'>;
  apps: Pick<SlackApps, 'gatewayBot' | 'save'>;
  workspaces: Pick<SlackWorkspaces, 'find'>;
  takeAccessToken: TakeAccessToken;
  states: InstallStates;
  clock: Clock;
  installRedirectUrl: string;
}): StartInstall {
  return async ({ actor, fleetName }) => {
    if (!actor.scopes.includes(SLACK_SCOPE)) {
      return refuse('SLACK_SCOPE_NOT_HELD', `Installing a Slack bot needs ${SLACK_SCOPE}`);
    }
    const { fleetId } = actor;
    if ((await deps.workspaces.find(fleetId)) === undefined) {
      return refuse('SLACK_NOT_CONNECTED', 'The fleet is connected to no Slack workspace');
    }
    let bot = await deps.apps.gatewayBot(fleetId);
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
    const url = new URL(bot.installUrl);
    url.searchParams.set('state', deps.states.seal({ fleetId, appId: bot.appId, expiresAt: new Date(deps.clock.now().getTime() + INSTALL_MS) }));
    return ok({ url: url.toString() });
  };
}
