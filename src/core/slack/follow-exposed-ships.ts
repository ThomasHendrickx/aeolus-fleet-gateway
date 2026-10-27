import type { SlackApps, SlackShips, SlackTooling, SlackWorkspaces } from './ports.js';
import { shipBotDescription, type SlackAddresses } from './slack-app.js';
import type { TakeAccessToken } from './take-access-token.js';

export type FollowExposedShips = () => Promise<void>;

/**
 * Use case: one pass of the gateway reading each exposed ship by its id
 * (gateway scopes 9.2, L20), in every fleet whose configuration token Slack
 * has not refused. A renamed ship's bot is given its whole manifest anew,
 * the new name kept once Slack took it; a retired ship's bot is deleted in
 * Slack and forgotten. What the fleet or Slack does not answer now is
 * followed at the next pass.
 */
export function createFollowExposedShips(deps: {
  workspaces: Pick<SlackWorkspaces, 'rotatable'>;
  apps: Pick<SlackApps, 'all' | 'save' | 'remove'>;
  ships: Pick<SlackShips, 'read'>;
  slack: Pick<SlackTooling, 'renameApp' | 'removeApp'>;
  takeAccessToken: TakeAccessToken;
  addresses: SlackAddresses;
}): FollowExposedShips {
  return async () => {
    for (const fleetId of await deps.workspaces.rotatable()) {
      for (const app of await deps.apps.all(fleetId)) {
        if (app.shipId === null) {
          continue;
        }
        const ship = await deps.ships.read(fleetId, app.shipId);
        if (!ship.isOk) {
          continue;
        }
        const description = shipBotDescription(ship.value, deps.addresses);
        const isRetired = ship.value.status === 'retired';
        if (!isRetired && description.name === app.name) {
          continue;
        }
        const accessToken = await deps.takeAccessToken(fleetId);
        if (!accessToken.isOk) {
          break;
        }
        if (isRetired) {
          const removed = await deps.slack.removeApp(accessToken.value, app.appId);
          if (removed.isOk || removed.error.kind === 'refused') {
            await deps.apps.remove(fleetId, app.appId);
          }
        } else if ((await deps.slack.renameApp(accessToken.value, { appId: app.appId, description })).isOk) {
          await deps.apps.save({ ...app, name: description.name });
        }
      }
    }
  };
}
