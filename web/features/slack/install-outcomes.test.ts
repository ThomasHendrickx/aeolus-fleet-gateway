import { describe, expect, it } from 'vitest';

import { installOutcomeOf } from './install-outcomes';

describe("what the Slack page says of an install Slack sent back", () => {
  it("says the gateway's bot is in Slack once installed", () => {
    expect(installOutcomeOf('installed')).toEqual({ tone: 'ok', message: "The gateway's bot is in Slack" });
  });

  it('says why an install did not go in', () => {
    expect([installOutcomeOf('refused'), installOutcomeOf('other-workspace'), installOutcomeOf('cancelled')]).toEqual([
      { tone: 'attention', message: 'The install did not start here, took longer than ten minutes, or Slack refused it: press Install again' },
      { tone: 'attention', message: "Slack installed into another workspace than the fleet's: install into the connected workspace" },
      { tone: 'attention', message: 'The install was cancelled in Slack: nothing changed' },
    ]);
  });

  it('says nothing for an address that names no outcome the gateway sends', () => {
    expect([installOutcomeOf(undefined), installOutcomeOf('<b>pwned</b>')]).toEqual([undefined, undefined]);
  });
});
