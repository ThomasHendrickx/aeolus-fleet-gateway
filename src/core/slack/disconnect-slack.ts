import type { Actor } from '../actors/authenticate-actor.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { SLACK_SCOPE } from './connect-slack.js';
import type { SlackApps, SlackTooling, SlackWorkspaces } from './ports.js';
import { slackUnavailableMessage, type TakeAccessToken } from './take-access-token.js';

export type DisconnectSlack = (input: { actor: Actor }) => Promise<Result<undefined, DomainError<'SLACK_SCOPE_NOT_HELD' | 'SLACK_NOT_CONNECTED' | 'SLACK_TOKEN_REFUSED' | 'SLACK_UNAVAILABLE'>>>;

/**
 * Use case: an actor holding gateway:slack disconnects the fleet's
 * workspace (gateway scopes 9.1, after the page's confirm): every bot the
 * gateway made is removed in Slack, then the workspace and its apps are
 * forgotten. An app Slack refuses to remove is one it no longer knows. When
 * Slack does not answer, everything is kept, to disconnect again.
 */
export function createDisconnectSlack(deps: { slack: Pick<SlackTooling, 'removeApp'>; workspaces: Pick<SlackWorkspaces, 'remove'>; apps: Pick<SlackApps, 'all'>; takeAccessToken: TakeAccessToken }): DisconnectSlack {
  return async ({ actor }) => {
    if (!actor.scopes.includes(SLACK_SCOPE)) {
      return refuse('SLACK_SCOPE_NOT_HELD', `Disconnecting Slack needs ${SLACK_SCOPE}`);
    }
    const accessToken = await deps.takeAccessToken(actor.fleetId);
    if (!accessToken.isOk) {
      return accessToken;
    }
    for (const app of await deps.apps.all(actor.fleetId)) {
      const removed = await deps.slack.removeApp(accessToken.value, app.appId);
      if (!removed.isOk && removed.error.kind !== 'refused') {
        return refuse('SLACK_UNAVAILABLE', slackUnavailableMessage(removed.error));
      }
    }
    await deps.workspaces.remove(actor.fleetId);
    return ok(undefined);
  };
}
