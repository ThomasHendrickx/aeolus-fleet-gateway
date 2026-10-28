import type { ShipId } from '@aeolus-fleet/common';

import type { Actor } from '../actors/authenticate-actor.js';
import { SLACK_SCOPE } from './connect-slack.js';
import type { SlackApps, SlackShips, SlackWorkspaces } from './ports.js';
import { botStateOf, type BotState } from './slack-app.js';

/**
 * The Slack page's state (gateway scopes 9.6): connected or not, the
 * workspace by its name once Slack named it, who connected it, the
 * configuration token fresh or refused by Slack, the gateway's bot and
 * each exposed ship's bot.
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
      readonly bots: readonly ShownBot[];
      readonly canChange: boolean;
    };

/** An exposed ship's bot, by the ship's id: its name in the fleet now and in Slack, which differ until the gateway renames it there. */
export interface ShownBot {
  readonly appId: string;
  readonly shipId: ShipId;
  readonly shipName: string;
  readonly botName: string;
  readonly state: BotState;
}

export type ReadSlack = (actor: Actor) => Promise<SlackView>;

/** Use case: the fleet's Slack, as the Slack page shows it to the actor. */
export function createReadSlack(deps: { workspaces: Pick<SlackWorkspaces, 'find'>; apps: Pick<SlackApps, 'gatewayBot' | 'all'>; ships: Pick<SlackShips, 'read'> }): ReadSlack {
  return async (actor) => {
    const canChange = actor.scopes.includes(SLACK_SCOPE);
    const [workspace, bot, apps] = await Promise.all([deps.workspaces.find(actor.fleetId), deps.apps.gatewayBot(actor.fleetId), deps.apps.all(actor.fleetId)]);
    if (workspace === undefined) {
      return { state: 'notConnected', canChange };
    }
    const bots = await Promise.all(
      apps.flatMap((app) => {
        const { shipId } = app;
        if (shipId === null) {
          return [];
        }
        return [
          (async () => {
            const ship = await deps.ships.read(actor.fleetId, shipId);
            return { appId: app.appId, shipId, shipName: ship.isOk ? ship.value.name : app.name, botName: app.name, state: botStateOf(app) };
          })(),
        ];
      }),
    );
    return {
      state: 'connected',
      workspace: { teamId: workspace.teamId, name: workspace.teamName },
      connectedBy: workspace.connectedBy.name,
      connectedAt: workspace.connectedAt,
      tokenState: workspace.isTokenRefused ? 'refused' : 'fresh',
      gatewayBot: bot === undefined ? 'notMade' : bot.bot === null ? 'made' : 'installed',
      bots,
      canChange,
    };
  };
}
