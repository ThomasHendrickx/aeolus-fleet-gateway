/**
 * What the Slack page says of an install Slack sent back, by the outcome the
 * gateway's install door put in the address (src/adapters/http/slack-routes.ts):
 * never a text the address carries.
 */
const OUTCOMES = {
  installed: { tone: 'ok', message: "The gateway's bot is in Slack" },
  refused: { tone: 'attention', message: 'The install did not start here, took longer than ten minutes, or Slack refused it: press Install again' },
  'not-connected': { tone: 'attention', message: 'The fleet is connected to no Slack workspace now: connect it first' },
  'other-workspace': { tone: 'attention', message: "Slack installed into another workspace than the fleet's: install into the connected workspace" },
  unavailable: { tone: 'attention', message: 'Slack did not answer: press Install again' },
  cancelled: { tone: 'attention', message: 'The install was cancelled in Slack: nothing changed' },
} as const;

export type InstallOutcome = (typeof OUTCOMES)[keyof typeof OUTCOMES];

function isOutcome(outcome: string): outcome is keyof typeof OUTCOMES {
  return Object.hasOwn(OUTCOMES, outcome);
}

export function installOutcomeOf(outcome: string | undefined): InstallOutcome | undefined {
  return outcome !== undefined && isOutcome(outcome) ? OUTCOMES[outcome] : undefined;
}
