import { describe, expect, it } from 'vitest';

import { createSignInSeals } from './sign-in-seals.js';

const SECRET = 'a-gateway-secret-of-at-least-32-characters';
const SIGN_IN = {
  verifier: 'the-gateway-verifier-kept-secret-on-the-way',
  request: { client_id: 'https://claude.example.com/oauth/client.json', redirect_uri: 'https://claude.example.com/callback', state: 'state-1', scope: undefined },
  expiresAt: new Date('2026-10-19T09:10:00.000Z'),
};

describe("a sign-in sealed into pagasae's state", () => {
  it('opens to the sign-in it seals', () => {
    const seals = createSignInSeals(SECRET);

    expect(seals.open(seals.seal(SIGN_IN))).toEqual({ ...SIGN_IN, request: { client_id: SIGN_IN.request.client_id, redirect_uri: SIGN_IN.request.redirect_uri, state: 'state-1' } });
  });

  it('is safe in a URL and shows neither the verifier nor the request', () => {
    const state = createSignInSeals(SECRET).seal(SIGN_IN);

    expect({ isUrlSafe: /^[A-Za-z0-9_-]+$/.test(state), showsVerifier: state.includes('verifier'), showsClient: state.includes('claude') }).toEqual({ isUrlSafe: true, showsVerifier: false, showsClient: false });
  });

  it('differs each time, though it seals the same sign-in', () => {
    const seals = createSignInSeals(SECRET);

    expect(seals.seal(SIGN_IN)).not.toBe(seals.seal(SIGN_IN));
  });

  it("opens none for a state sealed under another gateway's secret", () => {
    const state = createSignInSeals('another-gateway-secret-of-32-characters!').seal(SIGN_IN);

    expect(createSignInSeals(SECRET).open(state)).toBeUndefined();
  });

  it('opens none for a state changed on the way', () => {
    const seals = createSignInSeals(SECRET);
    const state = seals.seal(SIGN_IN);
    const changed = `${state.slice(0, -2)}${state.endsWith('AA') ? 'BB' : 'AA'}`;

    expect(seals.open(changed)).toBeUndefined();
  });

  it.each(['', 'not-a-seal', 'AAAA'])('opens none for %j', (state) => {
    expect(createSignInSeals(SECRET).open(state)).toBeUndefined();
  });
});
