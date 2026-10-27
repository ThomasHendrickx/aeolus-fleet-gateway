import type { Actor } from '../actors/authenticate-actor.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { gatewayBotOf } from './gateway-bot.js';
import type { ShipNames, SlackApps, SlackTooling, SlackWorkspaces } from './ports.js';
import type { SlackAddresses } from './slack-app.js';
import { slackUnavailableMessage } from './take-access-token.js';

/** The scope that connects Slack and exposes ships as bots (gateway scopes B6). */
export const SLACK_SCOPE = 'gateway:slack';

export type ConnectSlackRefusal = DomainError<'SLACK_SCOPE_NOT_HELD' | 'NOT_AN_ACCOUNT' | 'ALREADY_CONNECTED' | 'SLACK_TOKEN_REFUSED' | 'SLACK_UNAVAILABLE' | 'OTHER_WORKSPACE'>;

export type ConnectSlack = (input: { actor: Actor; refreshToken: string; fleetName: string }) => Promise<Result<{ isGatewayBotMade: boolean }, ConnectSlackRefusal>>;

/**
 * Use case: an actor holding gateway:slack connects the fleet to one Slack
 * workspace by pasting an app configuration refresh token (gateway scopes
 * 9.1), signed in with their account: the token is a Slack user's own.
 * The token is rotated at once, which proves it and names the workspace,
 * and the new pair kept. Then the gateway makes its own bot (B5); when Slack
 * does not make it now, the fleet stays connected and Install makes it.
 * After Slack refused the kept token, a new token of the same workspace
 * connects again, keeping every app made.
 */
export function createConnectSlack(deps: {
  slack: Pick<SlackTooling, 'rotateConfigurationToken' | 'makeApp'>;
  workspaces: Pick<SlackWorkspaces, 'find' | 'save'>;
  apps: Pick<SlackApps, 'gatewayBot' | 'save'>;
  shipNames: ShipNames;
  clock: Clock;
  addresses: SlackAddresses;
}): ConnectSlack {
  return async ({ actor, refreshToken, fleetName }) => {
    if (!actor.scopes.includes(SLACK_SCOPE)) {
      return refuse('SLACK_SCOPE_NOT_HELD', `Connecting Slack needs ${SLACK_SCOPE}`);
    }
    if (actor.kind !== 'account' || actor.personShipId === null) {
      return refuse('NOT_AN_ACCOUNT', "Connect Slack on the gateway's pages, signed in with your account: a configuration token is a Slack user's own");
    }
    const kept = await deps.workspaces.find(actor.fleetId);
    if (kept !== undefined && !kept.isTokenRefused) {
      return refuse('ALREADY_CONNECTED', 'The fleet is connected to a Slack workspace already');
    }
    const rotated = await deps.slack.rotateConfigurationToken(refreshToken);
    if (!rotated.isOk) {
      return rotated.error.kind === 'refused'
        ? refuse('SLACK_TOKEN_REFUSED', `Slack refused the configuration token (${rotated.error.error}): copy a new one from your Slack app management page`)
        : refuse('SLACK_UNAVAILABLE', slackUnavailableMessage(rotated.error));
    }
    const { token, teamId } = rotated.value;
    if (kept !== undefined && kept.teamId !== teamId) {
      return refuse('OTHER_WORKSPACE', `The fleet is connected to ${kept.teamName ?? kept.teamId}: connect with a configuration token of that workspace`);
    }
    const now = deps.clock.now();
    const name = (await deps.shipNames.nameOf(actor.fleetId, actor.personShipId)) ?? actor.personShipId;
    await deps.workspaces.save({
      fleetId: actor.fleetId,
      teamId,
      teamName: kept?.teamName ?? null,
      connectedBy: { shipId: actor.personShipId, name },
      connectedAt: now,
      token,
      isTokenRefused: false,
    });
    const bot = await gatewayBotOf(deps, { fleetId: actor.fleetId, fleetName, accessToken: token.accessToken });
    return ok({ isGatewayBotMade: bot.isOk });
  };
}
