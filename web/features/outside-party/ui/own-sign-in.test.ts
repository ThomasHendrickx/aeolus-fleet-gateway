import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { SignInOutcome } from '../own-sign-in';
import { OwnSignInCard, type OwnSignInRead } from './own-sign-in-card';

// Your own sign-in on a server's page, as M2 shows it (decision 0067, slice S8).

const FLEET = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const NOW = new Date('2026-10-29T10:47:00Z');
const JORIS = { subject: 'sub-joris', name: 'joris@acme.com' };

const NOT_SIGNED_IN: OwnSignInRead = { kind: 'read', own: { state: 'notSignedIn' } };
const SIGNED_IN: OwnSignInRead = { kind: 'read', own: { state: 'signedIn', outsideAccount: JORIS, signedInAt: '2026-10-29T10:42:00Z', lastUsedAt: '2026-10-29T10:42:00Z' } };

/** The card's text as a person reads it: React's form script, its tags and its escapes gone. */
function textOf(markup: string): string {
  return markup.replaceAll(/<script>.*?<\/script>/gs, '').replaceAll(/<[^>]*>/g, ' ').replaceAll('&#x27;', "'").replaceAll(/\s+/g, ' ').trim();
}

function card(read: OwnSignInRead, outcome: SignInOutcome | null = null): string {
  return renderToStaticMarkup(createElement(OwnSignInCard, { fleetId: FLEET, party: 'attio', read, outcome, now: NOW }));
}

describe('your sign-in on a server where each person signs in (M2)', () => {
  it('says you are not signed in, that your ships are refused until you do, and offers Sign in', () => {
    const markup = card(NOT_SIGNED_IN);

    expect(textOf(markup)).toBe("Your sign-in Not signed in Until you sign in, your ships' calls to attio are refused. Sign in");
    expect(markup).toContain('data-testid="outside-party-sign-in-start"');
    expect(markup).toContain(`<input type="hidden" name="fleet" value="${FLEET}"/><input type="hidden" name="name" value="attio"/>`);
  });

  it('shows the outside account you signed in as, when, and when last used, with Sign in again and Remove', () => {
    const markup = card({ kind: 'read', own: { ...SIGNED_IN.own, signedInAt: '2026-10-29T09:42:00Z', lastUsedAt: '2026-10-29T10:42:00Z' } });

    expect(textOf(markup)).toBe('Your sign-in Signed in Account joris@acme.com Signed in 29 Oct, 09:42 Last used 5 min ago Sign in again Remove');
    expect(markup).toContain('data-testid="outside-party-sign-in-remove"');
  });

  it('says a sign-in never used yet is Not yet used', () => {
    const text = textOf(card({ kind: 'read', own: { state: 'signedIn', outsideAccount: JORIS, signedInAt: '2026-10-29T10:46:30Z', lastUsedAt: null } }));

    expect(text).toContain('Signed in Just now Last used Not yet');
  });

  it('names the outside account by its subject when the server gave no name, and says Not known when it gave neither', () => {
    const texts = [{ subject: 'sub-joris', name: null }, { subject: null, name: null }].map((outsideAccount) => textOf(card({ kind: 'read', own: { ...SIGNED_IN.own, outsideAccount } })));

    expect(texts.map((text) => text.slice(text.indexOf('Account'), text.indexOf(' Signed in 29')))).toEqual(['Account sub-joris', 'Account Not known']);
  });

  it('says a lost sign-in, when and why the server refused to refresh it, with Sign in again', () => {
    const lost: OwnSignInRead = {
      kind: 'read',
      own: { state: 'lost', outsideAccount: JORIS, signedInAt: '2026-10-20T08:00:00Z', lastUsedAt: '2026-10-28T21:58:00Z', lost: { at: '2026-10-28T22:10:00Z', why: 'invalid_grant' } },
    };

    expect(textOf(card(lost))).toBe("Your sign-in Lost attio refused to refresh it on 28 Oct, 22:10: invalid_grant . Your ships' calls to attio are refused. Account joris@acme.com Last used 28 Oct, 21:58 Sign in again");
  });

  it('says signing in needs a person ship in the fleet, with nothing to press', () => {
    const markup = card({ kind: 'noPersonShip', fleetName: 'acme' });

    expect(textOf(markup)).toBe('Your sign-in Signing in needs a person ship in acme.');
    expect(markup).not.toContain('<button');
  });

  it("says why the API refused to read your sign-in, in place of it", () => {
    const markup = card({ kind: 'refused', message: 'There is no outside MCP server attio' });

    expect(textOf(markup)).toBe('Your sign-in There is no outside MCP server attio');
    expect(markup).toContain('role="alert"');
  });

  it.each<[string, SignInOutcome, OwnSignInRead, string]>([
    ['back, signed in', { kind: 'signedIn', serverError: null }, SIGNED_IN, 'Your sign-in Signed in You are signed in to attio. Account'],
    ['removed', { kind: 'removed', serverError: null }, NOT_SIGNED_IN, 'Your sign-in Not signed in Your sign-in to attio is removed. Until you sign in'],
    ['back, failed', { kind: 'failed', serverError: 'server_error' }, NOT_SIGNED_IN, 'Your sign-in Not signed in The sign-in did not finish: press Sign in again. server_error Until you sign in'],
    ['back, turned away', { kind: 'turnedAway', serverError: null }, NOT_SIGNED_IN, "Your sign-in Not signed in That attio account is another person's sign-in in this fleet: sign in as your own. Until you sign in"],
    ['back, cancelled', { kind: 'cancelled', serverError: 'access_denied' }, NOT_SIGNED_IN, 'Your sign-in Not signed in You are not signed in to attio: the sign-in was cancelled or refused there. access_denied Until you sign in'],
    ['back, did not answer', { kind: 'unavailable', serverError: null }, NOT_SIGNED_IN, "Your sign-in Not signed in attio's sign-in did not answer: try again in a moment. Until you sign in"],
  ])('says how the sign-in went: %s', (_name, outcome, read, said) => {
    expect(textOf(card(read, outcome))).toContain(said);
  });

  it('says the failures as alerts, a sign-in or removal as done, and a cancel as said, not alarmed', () => {
    const roleOf = (outcome: SignInOutcome) => /<p role="(\w+)"/.exec(card(NOT_SIGNED_IN, outcome))?.[1] ?? 'none';

    expect((['signedIn', 'removed', 'failed', 'turnedAway', 'cancelled', 'unavailable'] as const).map((kind) => roleOf({ kind, serverError: null }))).toEqual(['status', 'status', 'alert', 'alert', 'status', 'alert']);
  });
});
