import type { SlackWorkspaces } from './ports.js';
import type { TakeAccessToken } from './take-access-token.js';

export type RotateConfigurationTokens = () => Promise<void>;

/**
 * Use case: one pass of the gateway keeping each fleet's configuration
 * token alive (gateway scopes 9.1): every token Slack has not refused is
 * taken, which rotates it within its last hour. Run often enough that no
 * token's 12 hours end between two passes.
 */
export function createRotateConfigurationTokens(deps: { workspaces: Pick<SlackWorkspaces, 'rotatable'>; takeAccessToken: TakeAccessToken }): RotateConfigurationTokens {
  return async () => {
    for (const fleetId of await deps.workspaces.rotatable()) {
      await deps.takeAccessToken(fleetId);
    }
  };
}
