import { describe, expect, it } from 'vitest';

import { signInOutcomeOf, whenWordsOf } from './own-sign-in';

// Your own sign-in on a server's page, as M2 says it (decision 0067, slice S8).

describe('how a sign-in went, as the address back from the server says it', () => {
  it.each([
    ['signed-in', 'signedIn'],
    ['removed', 'removed'],
    ['failed', 'failed'],
    ['turned-away', 'turnedAway'],
    ['not-signed-in', 'cancelled'],
    ['unavailable', 'unavailable'],
  ])('reads %s as %s', (said, kind) => {
    expect(signInOutcomeOf({ 'sign-in': said })).toEqual({ kind, serverError: null });
  });

  it("keeps the authorization server's error code beside it", () => {
    expect(signInOutcomeOf({ 'sign-in': 'not-signed-in', error: 'access_denied' })).toEqual({ kind: 'cancelled', serverError: 'access_denied' });
  });

  it('reads nothing from an address that says no sign-in, or one it does not know', () => {
    expect([signInOutcomeOf({}), signInOutcomeOf({ 'sign-in': 'done' }), signInOutcomeOf({ 'sign-in': ['failed', 'failed'] })]).toEqual([null, null, null]);
  });
});

describe('when a sign-in was made or last used, in words', () => {
  const NOW = new Date('2026-10-29T10:47:00Z');

  it('says Just now within the minute', () => {
    expect(whenWordsOf('2026-10-29T10:46:01Z', NOW)).toBe('Just now');
  });

  it('says the minutes ago within the hour', () => {
    expect([whenWordsOf('2026-10-29T10:42:00Z', NOW), whenWordsOf('2026-10-29T09:47:01Z', NOW)]).toEqual(['5 min ago', '59 min ago']);
  });

  it('says the day and time from an hour ago', () => {
    expect([whenWordsOf('2026-10-29T09:47:00Z', NOW), whenWordsOf('2026-10-28T22:10:00Z', NOW)]).toEqual(['29 Oct, 09:47', '28 Oct, 22:10']);
  });
});
