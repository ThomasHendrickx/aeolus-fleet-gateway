import { describe, expect, it } from 'vitest';

import { failedReasonText, pickFieldsOf, timeLeft } from './authorize';

describe("the time a request waiting for approval has left, as the waiting page's ring shows it", () => {
  it('says days and hours', () => {
    expect(timeLeft(new Date('2026-10-28T12:00:00Z'), new Date('2026-10-21T09:30:00Z'))).toBe('7 d 2 h');
  });

  it('says 0 d 0 h in its last hour', () => {
    expect(timeLeft(new Date('2026-10-21T10:00:00Z'), new Date('2026-10-21T09:00:01Z'))).toBe('0 d 0 h');
  });

  it('says 0 d 1 h at exactly one hour left', () => {
    expect(timeLeft(new Date('2026-10-21T10:00:00Z'), new Date('2026-10-21T09:00:00Z'))).toBe('0 d 1 h');
  });

  it('says 0 d 0 h once it expired', () => {
    expect(timeLeft(new Date('2026-10-21T09:00:00Z'), new Date('2026-10-21T10:00:00Z'))).toBe('0 d 0 h');
  });
});

describe('why a browser got nowhere connecting an MCP client, as the failed page says it', () => {
  it('says why for a reason the gateway names', () => {
    expect(failedReasonText('otherBrowserWaiting')).toBe('This request was made in another browser, so it is not yours to follow. Start again from your MCP client.');
  });

  it('says the connection did not go through for a reason it does not know', () => {
    expect(failedReasonText('somethingElse')).toBe('The connection did not go through. Start again from your MCP client.');
  });

  it('says the connection did not go through when no reason is given', () => {
    expect(failedReasonText(undefined)).toBe('The connection did not go through. Start again from your MCP client.');
  });
});

describe('the authorization request the pick page carries on to the sign-in', () => {
  it('keeps the parameters the browser sent once each, in their order', () => {
    expect(pickFieldsOf({ client_id: 'c', redirect_uri: 'http://127.0.0.1/cb', state: 's' })).toEqual([
      ['client_id', 'c'],
      ['redirect_uri', 'http://127.0.0.1/cb'],
      ['state', 's'],
    ]);
  });

  it('leaves out a parameter sent twice, and a holder, which the page picks itself', () => {
    expect(pickFieldsOf({ client_id: 'c', scope: ['a', 'b'], holder: 'account' })).toEqual([['client_id', 'c']]);
  });
});
