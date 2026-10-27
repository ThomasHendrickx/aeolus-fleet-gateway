import type { Actor } from '../actors/authenticate-actor.js';
import { SLACK_SCOPE } from './connect-slack.js';
import type { SlackApps, SlackWorkspaces } from './ports.js';

/**
 * The Slack page's state (gateway scopes 9.6): connected or not, the
 * workspace by its name once Slack named it, who connected it, the
 * configuration token fresh or refused by Slack, and the gateway's bot.
 * canChange: whether the actor holds gateway:slack; others read only.
 */
export type SlackView =
  | { readonly state: 'notConnected'; readonly canChange: boolean }
  | {
      readonly state: 'connected';
      readonly workspace: { readonly teamId: string; readonly name: string | null };
      readonly connectedBy: string;
      readonly connectedAt: Date;
      readonly tokenState: 'fresh' | 'refused';
      readonly gatewayBot: 'notMade' | 'made' | 'installed';
      readonly canChange: boolean;
    };

export type ReadSlack = (actor: Actor) => Promise<SlackView>;

/** Use case: the fleet's Slack, as the Slack page shows it to the actor. */
export function createReadSlack(deps: { workspaces: Pick<SlackWorkspaces, 'find'>; apps: Pick<SlackApps, 'gatewayBot'> }): ReadSlack {
  return async (actor) => {
    const canChange = actor.scopes.includes(SLACK_SCOPE);
    const [workspace, bot] = await Promise.all([deps.workspaces.find(actor.fleetId), deps.apps.gatewayBot(actor.fleetId)]);
    if (workspace === undefined) {
      return { state: 'notConnected', canChange };
    }
    return {
      state: 'connected',
      workspace: { teamId: workspace.teamId, name: workspace.teamName },
      connectedBy: workspace.connectedBy.name,
      connectedAt: workspace.connectedAt,
      tokenState: workspace.isTokenRefused ? 'refused' : 'fresh',
      gatewayBot: bot === undefined ? 'notMade' : bot.bot === null ? 'made' : 'installed',
      canChange,
    };
  };
}
