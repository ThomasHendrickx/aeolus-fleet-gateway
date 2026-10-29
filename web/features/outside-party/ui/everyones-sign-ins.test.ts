import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { IDLE, type FormState } from '../../forms/form-state';
import { EveryonesSignInsSkeleton, SignInsCard, type PersonSignIn } from './everyones-sign-ins';

// Everyone's sign-ins on a server's page, for approvers, as M3 shows it (decision 0067, slice S9).

const NOW = '2026-10-29T10:47:00Z';

type SignedIn = Extract<PersonSignIn, { state: 'signedIn' }>;

/** Joris's sign-in as the API answers it to an approver, with what a test changes. */
function aPersonSignIn(changed: Partial<SignedIn> = {}): SignedIn {
  return {
    personShipId: 'shp_01m3tbfspe96yf1rnr4ank9jrs',
    personName: 'joris',
    isYours: false,
    state: 'signedIn',
    outsideAccount: { subject: 'sub-joris', name: 'joris@acme.com' },
    signedInAt: '2026-10-27T09:15:00Z',
    lastUsedAt: '2026-10-29T10:45:00Z',
    ...changed,
  };
}

const MATHILDE = aPersonSignIn({ personShipId: 'shp_01m3tbfspe96yf1rnr4ank9mth', personName: 'mathilde', isYours: true, outsideAccount: { subject: 'sub-mathilde', name: 'mathilde@acme.com' } });
const JORIS: PersonSignIn = { ...aPersonSignIn({ lastUsedAt: '2026-10-28T21:58:00Z' }), state: 'lost', lost: { at: '2026-10-28T22:10:00Z', why: 'invalid_grant' } };
const SAM = aPersonSignIn({ personShipId: 'shp_01m3tbfspe96yf1rnr4ank9sam', personName: 'sam', outsideAccount: { subject: 'sub-sam', name: 'sam@acme.com' }, lastUsedAt: null });
const PEOPLE = [MATHILDE, JORIS, SAM];

/** The card's text as a person reads it: its tags and escapes gone. */
function textOf(markup: string): string {
  return markup.replaceAll(/<[^>]*>/g, ' ').replaceAll('&#x27;', "'").replaceAll(/\s+/g, ' ').trim();
}

const NOTHING = () => undefined;

function card(view: Partial<{ rows: PersonSignIn[]; refusal: string | null; hasMore: boolean; confirming: string | null; removing: string | null; outcome: FormState }> = {}): string {
  return renderToStaticMarkup(
    createElement(SignInsCard, {
      party: 'attio',
      now: NOW,
      rows: PEOPLE,
      refusal: null,
      hasMore: false,
      isLoadingMore: false,
      confirming: null,
      removing: null,
      outcome: IDLE,
      onRemove: NOTHING,
      onConfirm: NOTHING,
      onKeep: NOTHING,
      onMore: NOTHING,
      ...view,
    }),
  );
}

const rowsOf = (markup: string) => markup.split('data-testid="outside-party-sign-ins-row"').length - 1;

describe("everyone's sign-ins to a server where each person signs in, for approvers (M3)", () => {
  it('shows each person, their outside account, state and when last used, with Remove, and how many', () => {
    const markup = card();

    expect(textOf(markup.slice(0, markup.indexOf('<tbody')))).toBe("Everyone's sign-ins 3 Person Account State Last used Remove");
    expect(rowsOf(markup)).toBe(3);
    expect(textOf(markup)).toContain('mathilde (you) mathilde@acme.com · last used 2 min ago Signed in 2 min ago Remove');
    expect(textOf(markup)).toContain('joris joris@acme.com · last used 28 Oct, 21:58 Lost 28 Oct, 21:58 Remove');
    expect(textOf(markup)).toContain('sam sam@acme.com · last used not yet Signed in Not yet Remove');
  });

  it('names a person the fleet gave no name by their person ship, and an outside account by its subject or as not known', () => {
    const text = textOf(card({ rows: [aPersonSignIn({ personName: null, outsideAccount: { subject: 'sub-joris', name: null } }), aPersonSignIn({ personShipId: 'shp_01m3tbfspe96yf1rnr4ank9sam', outsideAccount: { subject: null, name: null } })] }));

    expect(text).toContain('shp_01m3tbfspe96yf1rnr4ank9jrs sub-joris');
    expect(text).toContain('joris Not known');
  });

  it('asks to confirm a removal in place, saying their ships are refused until they sign in again', () => {
    const markup = card({ confirming: JORIS.personShipId });

    expect(textOf(markup)).toContain("Remove joris's sign-in? Their ships' calls to attio are refused until they sign in again. Remove joris's sign-in Keep");
    expect(markup.split('data-testid="outside-party-sign-ins-confirm"').length - 1).toBe(1);
    expect(markup.indexOf('data-testid="outside-party-sign-ins-confirm"') > markup.indexOf('joris@acme.com')).toBe(true);
  });

  it('says Removing… on the confirmed removal while it is on its way', () => {
    expect(textOf(card({ confirming: JORIS.personShipId, removing: JORIS.personShipId }))).toContain('Removing… Keep');
  });

  it('says a removal as done above the list', () => {
    const text = textOf(card({ rows: [MATHILDE, SAM], outcome: { kind: 'done', message: "joris's sign-in is removed, and revoked at attio." } }));

    expect(text.startsWith("Everyone's sign-ins 2 joris's sign-in is removed, and revoked at attio. Person")).toBe(true);
  });

  it('says why the API refused a removal, as an alert', () => {
    expect(card({ outcome: { kind: 'refused', message: 'shp_01m3tbfspe96yf1rnr4ank9jrs is not signed in to attio' } })).toContain('role="alert"');
  });

  it('offers Show more while a next page follows, and says it is on its way', () => {
    expect([card({ hasMore: true }), card()].map((markup) => markup.includes('data-testid="outside-party-sign-ins-more"'))).toEqual([true, false]);
    expect(textOf(renderToStaticMarkup(createElement(SignInsCard, { party: 'attio', now: NOW, rows: PEOPLE, refusal: null, hasMore: true, isLoadingMore: true, confirming: null, removing: null, outcome: IDLE, onRemove: NOTHING, onConfirm: NOTHING, onKeep: NOTHING, onMore: NOTHING })))).toContain('Showing more…');
  });

  it('says nobody has signed in yet, with no table', () => {
    const markup = card({ rows: [] });

    expect(textOf(markup)).toBe("Everyone's sign-ins 0 Nobody has signed in yet.");
  });

  it('says why the API refused the list in place of it, with no count', () => {
    const markup = card({ rows: [], refusal: 'The fleet did not answer: try again in a moment.' });

    expect(textOf(markup)).toBe("Everyone's sign-ins The fleet did not answer: try again in a moment.");
    expect(markup).toContain('role="alert"');
  });

  it("shows skeleton rows under the heading while everyone's sign-ins are read", () => {
    const markup = renderToStaticMarkup(createElement(EveryonesSignInsSkeleton, { party: 'attio' }));

    expect(textOf(markup)).toBe("Everyone's sign-ins Person Account State Last used Remove");
    expect(markup).toContain('aria-busy="true"');
    expect(markup.split('animate-pulse').length - 1).toBeGreaterThanOrEqual(3);
  });
});
