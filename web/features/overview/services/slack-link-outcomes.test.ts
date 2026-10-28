import { describe, expect, it } from 'vitest';

import { slackLinkOutcomeOf } from './slack-link-outcomes';

// What the Overview says of a Slack link (gateway scopes 9.3), by the
// outcome the gateway put in the address; a second link refused names the
// first.

describe('what the Overview says of a Slack link', () => {
  it('says the Slack account is linked', () => {
    expect(slackLinkOutcomeOf({ slack: 'linked' })).toEqual({ isFailure: false, message: 'Your Slack account is linked: message the fleet\'s bots in Slack' });
  });

  it('refuses a second link, naming the first', () => {
    expect([slackLinkOutcomeOf({ slack: 'slack-user-linked', name: 'joris' }), slackLinkOutcomeOf({ slack: 'account-linked', name: 'mathilde.old' })]).toEqual([
      { isFailure: true, message: 'This Slack account is linked to joris in this fleet already' },
      { isFailure: true, message: 'Your account is linked to Slack as @mathilde.old already: unlink it first' },
    ]);
  });

  it('says an account with no person ship in the fleet cannot link', () => {
    expect(slackLinkOutcomeOf({ slack: 'no-person-ship' })).toEqual({ isFailure: true, message: 'Your account has no person ship in this fleet' });
  });

  it('says nothing for an address that names no outcome the gateway sends', () => {
    expect([slackLinkOutcomeOf({}), slackLinkOutcomeOf({ slack: '<b>pwned</b>' })]).toEqual([undefined, undefined]);
  });
});
