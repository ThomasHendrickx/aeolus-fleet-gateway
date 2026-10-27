import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential, CredentialOf } from '../actors/credential-of.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { SLACK_SCOPE } from './connect-slack.js';
import type { SlackApps, SlackShips, SlackTooling } from './ports.js';
import { managedShipBot } from './ship-bot.js';
import { slackUnavailableMessage, type TakeAccessToken } from './take-access-token.js';

export type RemoveBot = (input: { actor: Actor; as: ActorCredential; appId: string }) => Promise<
  Result<undefined, DomainError<'SLACK_SCOPE_NOT_HELD' | 'NO_SUCH_BOT' | 'NOT_REACHABLE' | 'FLEET_UNAVAILABLE' | 'SLACK_NOT_CONNECTED' | 'SLACK_TOKEN_REFUSED' | 'SLACK_UNAVAILABLE'>>
>;

/**
 * Use case: an actor holding gateway:slack, within manage reach of the ship,
 * removes the ship's bot after the page's confirm (gateway scopes 9.2): its
 * app is deleted in Slack, then forgotten. An app Slack refuses to delete is
 * one it no longer knows.
 */
export function createRemoveBot(deps: { slack: Pick<SlackTooling, 'removeApp'>; apps: Pick<SlackApps, 'find' | 'remove'>; ships: SlackShips; takeAccessToken: TakeAccessToken; credentialOf: CredentialOf }): RemoveBot {
  return async ({ actor, as, appId }) => {
    if (!actor.scopes.includes(SLACK_SCOPE)) {
      return refuse('SLACK_SCOPE_NOT_HELD', `Removing a Slack bot needs ${SLACK_SCOPE}`);
    }
    const bot = await managedShipBot(deps, { actor, as, appId });
    if (!bot.isOk) {
      return bot;
    }
    const accessToken = await deps.takeAccessToken(actor.fleetId);
    if (!accessToken.isOk) {
      return accessToken;
    }
    const removed = await deps.slack.removeApp(accessToken.value, appId);
    if (!removed.isOk && removed.error.kind !== 'refused') {
      return refuse('SLACK_UNAVAILABLE', slackUnavailableMessage(removed.error));
    }
    await deps.apps.remove(actor.fleetId, appId);
    return ok(undefined);
  };
}
