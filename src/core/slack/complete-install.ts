import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { InstallStates, SlackApps, SlackTooling, SlackWorkspaces } from './ports.js';
import { slackUnavailableMessage } from './take-access-token.js';

export type CompleteInstallRefusal = DomainError<'INSTALL_REFUSED' | 'SLACK_NOT_CONNECTED' | 'OTHER_WORKSPACE' | 'SLACK_UNAVAILABLE'>;

export type CompleteInstall = (input: { code: string; state: string }) => Promise<Result<{ fleetId: FleetId }, CompleteInstallRefusal>>;

/**
 * Use case: Slack's install screen sends the person back with a code and
 * the state the gateway sealed (gateway scopes 9.1). Within its ten minutes,
 * the code is turned into the app's bot token, kept in the vault, and the
 * workspace's name kept as Slack says it. An install into another workspace
 * than the fleet's keeps nothing.
 */
export function createCompleteInstall(deps: {
  slack: Pick<SlackTooling, 'completeInstall'>;
  apps: Pick<SlackApps, 'find' | 'save'>;
  workspaces: Pick<SlackWorkspaces, 'find' | 'change'>;
  states: InstallStates;
  clock: Clock;
  installRedirectUrl: string;
}): CompleteInstall {
  return async ({ code, state }) => {
    const opened = deps.states.open(state);
    const app = opened !== undefined && opened.expiresAt > deps.clock.now() ? await deps.apps.find(opened.fleetId, opened.appId) : undefined;
    if (opened === undefined || app === undefined) {
      return refuse('INSTALL_REFUSED', 'This install did not start at the gateway, or took longer than ten minutes: press Install again');
    }
    const workspace = await deps.workspaces.find(opened.fleetId);
    if (workspace === undefined) {
      return refuse('SLACK_NOT_CONNECTED', 'The fleet is connected to no Slack workspace');
    }
    const installed = await deps.slack.completeInstall({ clientId: app.clientId, clientSecret: app.clientSecret, code, redirectUrl: deps.installRedirectUrl });
    if (!installed.isOk) {
      return installed.error.kind === 'refused' ? refuse('INSTALL_REFUSED', `Slack refused the install (${installed.error.error}): press Install again`) : refuse('SLACK_UNAVAILABLE', slackUnavailableMessage(installed.error));
    }
    const { teamId, teamName, botToken, botUserId } = installed.value;
    if (teamId !== workspace.teamId) {
      return refuse('OTHER_WORKSPACE', `The fleet is connected to ${workspace.teamName ?? workspace.teamId}: install into that workspace`);
    }
    await deps.apps.save({ ...app, bot: { token: botToken, userId: botUserId }, installStartedAt: null, removedInSlackAt: null });
    // Held, so a configuration token rotated meanwhile is kept.
    await deps.workspaces.change(opened.fleetId, (current) => Promise.resolve({ ...current, teamName }));
    return ok({ fleetId: opened.fleetId });
  };
}
