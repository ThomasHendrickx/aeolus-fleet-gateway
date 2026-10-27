import type { FleetId } from '@aeolus-fleet/common';

import type { AccountOfSignIn } from '../account-sign-in/account-of-sign-in.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { err, ok, type Result } from '../shared/result.js';
import type { LinkStates, ShipNames, SlackApps, SlackLinks, SlackSignIn, SlackWorkspaces } from './ports.js';
import { slackUnavailableMessage } from './take-access-token.js';

/** Why no link was kept; a link refused for one kept already names the fleet, and the first link's account or Slack name. */
export type CompleteLinkRefusal =
  | DomainError<'LINK_REFUSED' | 'SLACK_NOT_CONNECTED' | 'NO_SUCH_BOT' | 'OTHER_WORKSPACE' | 'SLACK_UNAVAILABLE'>
  | (DomainError<'SLACK_USER_LINKED' | 'ACCOUNT_LINKED'> & { readonly fleetId: FleetId; readonly name: string });

export type CompleteLink = (input: { code: string; state: string; signIn: string | undefined }) => Promise<Result<{ fleetId: FleetId }, CompleteLinkRefusal>>;

/**
 * Use case: Sign in with Slack sends the person back with a code and the
 * link's state the gateway sealed (gateway scopes 9.3). Within its ten
 * minutes, the code names the Slack workspace and user, and the link is kept
 * by fleet, workspace and user, and person ship. One Slack user links to one
 * account per fleet: a second link is refused, naming the first. An account
 * keeps one link, so linking another Slack user waits until it is unlinked.
 * The same user linking the same account again links it anew, as after a
 * disabled account's link stopped. The link completes only in a browser
 * whose shared sign-in names the account that started it, so a followed
 * link never attaches the follower's Slack user to the starter's account.
 */
export function createCompleteLink(deps: {
  workspaces: Pick<SlackWorkspaces, 'find'>;
  apps: Pick<SlackApps, 'gatewayBot'>;
  links: SlackLinks;
  signIn: Pick<SlackSignIn, 'complete'>;
  states: LinkStates;
  accountOf: (asked: Parameters<AccountOfSignIn>[0]) => ReturnType<AccountOfSignIn>;
  shipNames: ShipNames;
  clock: Clock;
  linkRedirectUrl: string;
}): CompleteLink {
  return async ({ code, state, signIn }) => {
    const now = deps.clock.now();
    const opened = deps.states.open(state);
    if (opened === undefined || opened.expiresAt <= now) {
      return refuse('LINK_REFUSED', 'This link did not start at the gateway, or took longer than ten minutes: press Link Slack again');
    }
    const { fleetId, accountId, personShipId } = opened;
    const signedIn = signIn === undefined ? undefined : await deps.accountOf({ signIn, fleetId });
    if (signedIn === undefined || !signedIn.isOk || signedIn.value.accountId !== accountId) {
      return refuse('LINK_REFUSED', 'This link was started by another account or browser: sign in and press Link Slack again');
    }
    const workspace = await deps.workspaces.find(fleetId);
    if (workspace === undefined) {
      return refuse('SLACK_NOT_CONNECTED', 'The fleet is connected to no Slack workspace');
    }
    const bot = await deps.apps.gatewayBot(fleetId);
    if (bot === undefined) {
      return refuse('NO_SUCH_BOT', "The fleet's own Slack bot is not made");
    }
    const slackSignIn = await deps.signIn.complete({ clientId: bot.clientId, clientSecret: bot.clientSecret, code, redirectUrl: deps.linkRedirectUrl });
    if (!slackSignIn.isOk) {
      return slackSignIn.error.kind === 'refused' ? refuse('LINK_REFUSED', `Slack refused the sign-in (${slackSignIn.error.error}): press Link Slack again`) : refuse('SLACK_UNAVAILABLE', slackUnavailableMessage(slackSignIn.error));
    }
    const { teamId, userId, name } = slackSignIn.value;
    if (teamId !== workspace.teamId) {
      return refuse('OTHER_WORKSPACE', `The fleet is connected to ${workspace.teamName ?? workspace.teamId}: sign in with Slack there`);
    }
    const first = await deps.links.find(fleetId, { teamId, userId });
    if (first !== undefined && first.accountId !== accountId) {
      const firstName = (await deps.shipNames.nameOf(fleetId, first.personShipId)) ?? 'another account';
      return err({ kind: 'SLACK_USER_LINKED', message: `This Slack account is linked to ${firstName} in this fleet already`, fleetId, name: firstName });
    }
    const own = await deps.links.ofAccount(fleetId, accountId);
    if (own !== undefined && own.slackUserId !== userId) {
      return err({ kind: 'ACCOUNT_LINKED', message: `Your account is linked to Slack as @${own.slackName} already: unlink it on the Overview first`, fleetId, name: own.slackName });
    }
    if (own !== undefined) {
      await deps.links.remove(fleetId, accountId);
    }
    const added = await deps.links.add({ fleetId, teamId, slackUserId: userId, slackName: name, accountId, personShipId, linkedAt: now, stoppedAt: null, isShowingAll: false });
    if (added === 'taken') {
      // Another link of the Slack user or the account was kept meanwhile.
      return refuse('LINK_REFUSED', 'This Slack account or your account was linked meanwhile: reload the Overview');
    }
    return ok({ fleetId });
  };
}
