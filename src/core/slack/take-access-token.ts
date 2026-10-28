import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { SlackRefusal, SlackTooling, SlackWorkspaces } from './ports.js';
import { isFresh, type SlackWorkspace } from './slack-workspace.js';

export type TakeAccessTokenRefusal = DomainError<'SLACK_NOT_CONNECTED' | 'SLACK_TOKEN_REFUSED' | 'SLACK_UNAVAILABLE'>;

export type TakeAccessToken = (fleetId: FleetId) => Promise<Result<string, TakeAccessTokenRefusal>>;

/** What a page says of a configuration token Slack refused (gateway scopes 9.1). */
export const TOKEN_REFUSED_MESSAGE = 'Slack refused the configuration token. Connect again to make or change bots; bots already installed keep working';

/** What a page says when Slack did not do what was asked for now: rate limited, or no answer. */
export function slackUnavailableMessage(refusal: Exclude<SlackRefusal, { kind: 'refused' }>): string {
  return refusal.kind === 'rateLimited' ? `Slack asks to wait ${String(refusal.retryAfterSeconds)} seconds: try again then` : 'Slack did not answer: try again';
}

/**
 * Use case: the fleet's configuration access token, to make or remove an app
 * with. Fresh, it is used as kept; within its last hour it is rotated first,
 * holding the workspace, so its single-use refresh token is spent once.
 * Slack refusing the refresh token marks it refused until someone connects
 * again; Slack not answering keeps the old pair, to rotate again later.
 */
export function createTakeAccessToken(deps: { slack: Pick<SlackTooling, 'rotateConfigurationToken'>; workspaces: Pick<SlackWorkspaces, 'change'>; clock: Clock }): TakeAccessToken {
  return async (fleetId) => {
    let outcome: Result<string, TakeAccessTokenRefusal> | undefined;
    const rotate = async (workspace: SlackWorkspace): Promise<SlackWorkspace> => {
      if (workspace.isTokenRefused) {
        outcome = refuse('SLACK_TOKEN_REFUSED', TOKEN_REFUSED_MESSAGE);
        return workspace;
      }
      if (isFresh(workspace.token, deps.clock.now())) {
        outcome = ok(workspace.token.accessToken);
        return workspace;
      }
      const rotated = await deps.slack.rotateConfigurationToken(workspace.token.refreshToken);
      if (rotated.isOk) {
        outcome = ok(rotated.value.token.accessToken);
        return { ...workspace, token: rotated.value.token };
      }
      if (rotated.error.kind === 'refused') {
        outcome = refuse('SLACK_TOKEN_REFUSED', TOKEN_REFUSED_MESSAGE);
        return { ...workspace, isTokenRefused: true };
      }
      outcome = refuse('SLACK_UNAVAILABLE', slackUnavailableMessage(rotated.error));
      return workspace;
    };
    await deps.workspaces.change(fleetId, rotate);
    return outcome ?? refuse('SLACK_NOT_CONNECTED', 'The fleet is connected to no Slack workspace');
  };
}
