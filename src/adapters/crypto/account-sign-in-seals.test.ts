import { describe, expect, it } from 'vitest';

import { createSignInSeals } from './sign-in-seals.js';
import { createAccountSignInSeals } from './account-sign-in-seals.js';

const SECRET = 'a-gateway-secret-of-at-least-32-characters';
const SIGN_IN = {
  verifier: 'the-gateway-verifier-kept-secret-on-the-way',
  browserSecret: 'the-secret-the-browser-holds-in-a-cookie',
  returnTo: '/overview?fleet=flt_01m3tb1zgr5h2ffee12xnch8sv',
  expiresAt: new Date('2026-10-21T09:10:00.000Z'),
};

describe("a sign-in to the pages sealed into pagasae's state", () => {
  it('opens to the sign-in it seals', () => {
    const seals = createAccountSignInSeals(SECRET);

    expect(seals.open(seals.seal(SIGN_IN))).toEqual(SIGN_IN);
  });

  it("is safe in a URL and shows neither the verifier nor the browser's secret", () => {
    const state = createAccountSignInSeals(SECRET).seal(SIGN_IN);

    expect({ isUrlSafe: /^[A-Za-z0-9_-]+$/.test(state), showsVerifier: state.includes('verifier'), showsBrowserSecret: state.includes('cookie') }).toEqual({ isUrlSafe: true, showsVerifier: false, showsBrowserSecret: false });
  });

  it("opens none for a state sealed under another gateway's secret", () => {
    const state = createAccountSignInSeals('another-gateway-secret-of-32-characters!').seal(SIGN_IN);

    expect(createAccountSignInSeals(SECRET).open(state)).toBeUndefined();
  });

  it("opens none for an MCP client's sign-in state, sealed under its own label", () => {
    const state = createSignInSeals(SECRET).seal({ ...SIGN_IN, holder: 'page' });

    expect(createAccountSignInSeals(SECRET).open(state)).toBeUndefined();
  });

  it.each(['', 'not-a-seal', 'AAAA'])('opens none for %j', (state) => {
    expect(createAccountSignInSeals(SECRET).open(state)).toBeUndefined();
  });
});
