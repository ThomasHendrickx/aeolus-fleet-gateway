/**
 * What the Overview says of a Slack link (gateway scopes 9.3), by the
 * outcome the gateway's link door or the link page put in the address
 * (src/adapters/http/slack-routes.ts, web/app/(console)/slack/link): never
 * a text the address carries, but for the first link's name when a second
 * is refused.
 */
import type { SearchParams } from '../../../lib/gateway-api/page-api';

const OUTCOMES = {
  linked: { isFailure: false, message: "Your Slack account is linked: message the fleet's bots in Slack" },
  refused: { isFailure: true, message: 'The link did not start here, took longer than ten minutes, or Slack refused it: press Link Slack again' },
  'not-connected': { isFailure: true, message: 'The fleet is connected to no Slack workspace now' },
  'other-workspace': { isFailure: true, message: "You signed in to another Slack workspace than the fleet's: sign in to the connected workspace" },
  unavailable: { isFailure: true, message: 'Slack did not answer: press Link Slack again' },
  cancelled: { isFailure: true, message: 'The link was cancelled in Slack: nothing changed' },
  'no-person-ship': { isFailure: true, message: 'Your account has no person ship in this fleet' },
  'not-started': { isFailure: true, message: 'The link did not start: try again in a moment' },
} as const;

const NAMED = {
  'slack-user-linked': (name: string) => `This Slack account is linked to ${name} in this fleet already`,
  'account-linked': (name: string) => `Your account is linked to Slack as @${name} already: unlink it first`,
} as const;

export interface SlackLinkOutcome {
  readonly isFailure: boolean;
  readonly message: string;
}

function isOutcome(outcome: string): outcome is keyof typeof OUTCOMES {
  return Object.hasOwn(OUTCOMES, outcome);
}

function isNamed(outcome: string): outcome is keyof typeof NAMED {
  return Object.hasOwn(NAMED, outcome);
}

export function slackLinkOutcomeOf({ slack, name }: SearchParams): SlackLinkOutcome | undefined {
  if (typeof slack !== 'string') {
    return undefined;
  }
  if (isNamed(slack)) {
    return typeof name === 'string' ? { isFailure: true, message: NAMED[slack](name) } : undefined;
  }
  return isOutcome(slack) ? OUTCOMES[slack] : undefined;
}
