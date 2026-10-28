import type { Actor } from '../actors/authenticate-actor.js';
import type { CrewPersonShip } from '../people/crew-person-ship.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { LinkStates, SlackApps, SlackSignIn, SlackWorkspaces } from './ports.js';

/** How long a link the gateway started may take to come back from Slack. */
export const LINK_MS = 10 * 60 * 1000;

const NO_PERSON_SHIP = 'Your account has no person ship in this fleet';

export type StartLinkRefusal = DomainError<'NOT_A_PERSON' | 'SLACK_NOT_CONNECTED' | 'NO_SUCH_BOT' | 'FLEET_UNAVAILABLE'>;

export type StartLink = (input: { actor: Actor }) => Promise<Result<{ url: string }, StartLinkRefusal>>;

/**
 * Use case: a person presses Link Slack, on the Overview or in the answer a
 * bot gave them in Slack (gateway scopes 9.3): Sign in with Slack through
 * the fleet's own bot's app, for the fleet's workspace, with the link's
 * state sealed for ten minutes. Only an account with a person ship in the
 * fleet links. The gateway crews that ship now, with the account's token it
 * holds only while the person is here, so their messages from Slack can be
 * sent as it later.
 */
export function createStartLink(deps: {
  workspaces: Pick<SlackWorkspaces, 'find'>;
  apps: Pick<SlackApps, 'gatewayBot'>;
  signIn: Pick<SlackSignIn, 'authorizeUrl'>;
  states: LinkStates;
  crewPersonShip: CrewPersonShip;
  clock: Clock;
  linkRedirectUrl: string;
}): StartLink {
  return async ({ actor }) => {
    if (actor.kind !== 'account' || actor.personShipId === null || actor.accountToken === null) {
      return refuse('NOT_A_PERSON', NO_PERSON_SHIP);
    }
    const { fleetId, accountId, personShipId, accountToken } = actor;
    const workspace = await deps.workspaces.find(fleetId);
    if (workspace === undefined) {
      return refuse('SLACK_NOT_CONNECTED', 'The fleet is connected to no Slack workspace');
    }
    const bot = await deps.apps.gatewayBot(fleetId);
    if (bot === undefined) {
      return refuse('NO_SUCH_BOT', "The fleet's own Slack bot is not made");
    }
    const crewed = await deps.crewPersonShip({ fleetId, signedIn: { accountToken, personShipId } });
    if (!crewed.isOk) {
      switch (crewed.error.kind) {
        case 'noPersonShip':
          return refuse('NOT_A_PERSON', NO_PERSON_SHIP);
        case 'fleetRefused':
          return refuse('FLEET_UNAVAILABLE', `The fleet did not crew your person ship: ${crewed.error.message}`);
        case 'signedOut':
        case 'pagasaeUnavailable':
        case 'notConnected':
          return refuse('FLEET_UNAVAILABLE', 'The fleet did not crew your person ship: try again in a moment');
      }
    }
    const state = deps.states.seal({ fleetId, accountId, personShipId, expiresAt: new Date(deps.clock.now().getTime() + LINK_MS) });
    return ok({ url: deps.signIn.authorizeUrl({ clientId: bot.clientId, redirectUrl: deps.linkRedirectUrl, state, teamId: workspace.teamId }) });
  };
}
