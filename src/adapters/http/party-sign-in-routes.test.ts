import { describe, expect, it } from 'vitest';

import { ownStepPartyOf } from './party-sign-in-routes.js';

// The gateway's own step asks a person to sign in to a party, with the party's page as its link
// (decision 0067; Bridge, CC14). Its row says the action in the gateway's own words (aeolus-fleet#1535).
describe("the party of the gateway's own step, by the page it leads to", () => {
  const partyOf = ownStepPartyOf('https://gateway.example.com');

  it("is the party whose page the step leads to", () => {
    expect(partyOf('https://gateway.example.com/outside-parties/linear?fleet=flt_01m3tbfspe96yf1rnr4ank0flt')).toBe('linear');
  });

  it('reads the party as the page names it in the address', () => {
    expect(partyOf('https://gateway.example.com/outside-parties/acme%20crm?fleet=flt_01m3tbfspe96yf1rnr4ank0flt')).toBe('acme crm');
  });

  it.each([
    ['another page of the gateway', 'https://gateway.example.com/slack/link?fleet=flt_01m3tbfspe96yf1rnr4ank0flt'],
    ['the outside parties list', 'https://gateway.example.com/outside-parties?fleet=flt_01m3tbfspe96yf1rnr4ank0flt'],
    ['a page below a party', 'https://gateway.example.com/outside-parties/linear/tools'],
    ['another host', 'https://elsewhere.example.com/outside-parties/linear'],
    ['an address that does not read', 'not a url'],
  ])('is none for %s', (_, href) => {
    expect(partyOf(href)).toBeUndefined();
  });
});
