import type { Actor } from '../actors/authenticate-actor.js';
import type { SlackApps, SlackLinks, SlackWorkspaces } from './ports.js';

/** A person's Slack link as the Overview shows it: the workspace, and the Slack name linked, none while unlinked. */
export interface ShownSlackLink {
  readonly workspaceName: string;
  readonly link: { readonly slackName: string; readonly isShowingAll: boolean } | null;
}

export type ReadSlackLink = (input: { actor: Actor }) => Promise<ShownSlackLink | null>;

/**
 * Use case: the person's Slack link on the Overview (gateway scopes 9.6),
 * offered once the fleet's own bot is in the fleet's workspace, which then
 * has its name; nothing to an account with no person ship in the fleet.
 */
export function createReadSlackLink(deps: { workspaces: Pick<SlackWorkspaces, 'find'>; apps: Pick<SlackApps, 'gatewayBot'>; links: Pick<SlackLinks, 'ofAccount'> }): ReadSlackLink {
  return async ({ actor }) => {
    if (actor.kind !== 'account' || actor.personShipId === null) {
      return null;
    }
    const workspace = await deps.workspaces.find(actor.fleetId);
    const bot = await deps.apps.gatewayBot(actor.fleetId);
    if (workspace === undefined || bot === undefined || bot.bot === null || workspace.teamName === null) {
      return null;
    }
    const link = await deps.links.ofAccount(actor.fleetId, actor.accountId);
    return { workspaceName: workspace.teamName, link: link === undefined ? null : { slackName: link.slackName, isShowingAll: link.isShowingAll } };
  };
}
