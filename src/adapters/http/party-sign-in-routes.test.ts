import { describe, expect, it } from 'vitest';

import { ownStepActionOf } from './party-sign-in-routes.js';

// The gateway's own step asks a person to sign in to a party, with the party's page as its link
// (decision 0067; Bridge, CC14). Its row says the action in the gateway's own words (aeolus-fleet#1535).
describe("the gateway's own words for its own step's action", () => {
  const actionOf = ownStepActionOf('https://gateway.example.com');

  it("says Sign in to the party whose page the step leads to", () => {
    expect(actionOf('https://gateway.example.com/outside-parties/linear?fleet=flt_01m3tbfspe96yf1rnr4ank0flt')).toBe('Sign in to linear');
  });

  it('reads the party as the page names it in the address', () => {
    expect(actionOf('https://gateway.example.com/outside-parties/acme%20crm?fleet=flt_01m3tbfspe96yf1rnr4ank0flt')).toBe('Sign in to acme crm');
  });

  it.each([
    ['another page of the gateway', 'https://gateway.example.com/slack/link?fleet=flt_01m3tbfspe96yf1rnr4ank0flt'],
    ['the outside parties list', 'https://gateway.example.com/outside-parties?fleet=flt_01m3tbfspe96yf1rnr4ank0flt'],
    ['a page below a party', 'https://gateway.example.com/outside-parties/linear/tools'],
    ['another host', 'https://elsewhere.example.com/outside-parties/linear'],
    ['an address that does not read', 'not a url'],
  ])('has no words for %s', (_, href) => {
    expect(actionOf(href)).toBeUndefined();
  });
});
