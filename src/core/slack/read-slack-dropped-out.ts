import type { Actor } from '../actors/authenticate-actor.js';
import { ITEM_JOBS, routingOf, type RoutingDefaults, type Routes } from '../people/routing.js';
import type { SlackApps, SlackLinks } from './ports.js';
import { botStateOf } from './slack-app.js';

/** Why Slack shows a person nothing now: the fleet's own bot, by its name, was removed in Slack. */
export interface SlackDroppedOut {
  readonly botName: string;
}

export type ReadSlackDroppedOut = (input: { actor: Actor }) => Promise<SlackDroppedOut | null>;

/**
 * Use case: whether Slack dropped out for the person (Bridge, section 9: a
 * place fails, it drops out and Bridge says why). It did when the fleet's
 * own bot was removed in Slack (app_uninstalled, tokens_revoked) while it
 * showed the person something: they linked Slack and turned it on, or left
 * it on, for a job. Nothing to an account with no person ship in the fleet.
 */
export function createReadSlackDroppedOut(deps: { apps: Pick<SlackApps, 'gatewayBot'>; links: Pick<SlackLinks, 'ofAccount'>; routes: Routes; defaults: RoutingDefaults }): ReadSlackDroppedOut {
  return async ({ actor }) => {
    if (actor.kind !== 'account' || actor.personShipId === null) {
      return null;
    }
    const bot = await deps.apps.gatewayBot(actor.fleetId);
    if (bot === undefined || botStateOf(bot) !== 'removedInSlack') {
      return null;
    }
    const [link, routes] = await Promise.all([deps.links.ofAccount(actor.fleetId, actor.accountId), deps.routes.list({ fleetId: actor.fleetId, shipId: actor.personShipId })]);
    const routing = routingOf(routes, deps.defaults);
    return link !== undefined && ITEM_JOBS.some((job) => routing.isOn(job, 'slack')) ? { botName: bot.name } : null;
  };
}
