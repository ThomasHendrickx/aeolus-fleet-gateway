import { beforeEach, describe, expect, it } from 'vitest';

import { CHARLOTTE_SIGN_IN, fakeAccountSignInSeals, fakeSharedSignIn } from '../../../test/support/account-sign-in-fakes.js';
import { fakeSecrets } from '../../../test/support/oauth-fakes.js';
import { PAGASAE_URL } from '../../../test/support/sign-in-fakes.js';
import type { SharedSignIn } from './ports.js';
import { createCompleteAccountSignIn } from './complete-account-sign-in.js';
import { createSignOutAccount } from './sign-out-account.js';
import { createStartAccountSignIn } from './start-account-sign-in.js';

// A person signs in to the gateway's pages with the account sign-in every
// Aeolus app shares (header design H5): the gateway is one of pagasae's
// apps, sends the person there with the code flow and PKCE, naming no fleet,
// and keeps nothing; once back, the shared sign-in is the browser's.

const STARTED_AT = new Date('2026-10-21T09:00:00.000Z');

let now: Date;
let secrets: ReturnType<typeof fakeSecrets>;
let seals: ReturnType<typeof fakeAccountSignInSeals>;

beforeEach(() => {
  now = STARTED_AT;
  secrets = fakeSecrets();
  seals = fakeAccountSignInSeals();
});

const clock = { now: () => now };

function startSignIn() {
  return createStartAccountSignIn({ seals, signIns: fakeSharedSignIn({}), secrets, clock });
}

/** pagasae redeems its code pagasae-code-1 for the verifier the start drew, secret-1. */
function completeSignIn(signIns: SharedSignIn = fakeSharedSignIn({ code: { code: 'pagasae-code-1', verifier: 'secret-1' } })) {
  return createCompleteAccountSignIn({ seals, signIns, clock });
}

/** The person started signing in; pagasae sends them back with this, to the browser holding the secret the start drew. */
function started(returnTo?: string) {
  startSignIn()({ returnTo });
  return { state: 'sealed-1', code: 'pagasae-code-1', browserSecret: 'secret-2' };
}

describe('a person starts signing in to the pages', () => {
  it("is sent to pagasae with the gateway's own PKCE challenge, naming no fleet, and holds a new secret", () => {
    expect(startSignIn()({ returnTo: '/overview' })).toEqual({ redirectTo: `${PAGASAE_URL}/oauth/authorize?state=sealed-1&code_challenge=S256(secret-1)`, browserSecret: 'secret-2' });
  });

  it('seals the page to go back to for 10 minutes, with the verifier and the browser secret', () => {
    startSignIn()({ returnTo: '/overview?fleet=flt_1' });

    expect([...seals.held.values()]).toEqual([{ returnTo: '/overview?fleet=flt_1', verifier: 'secret-1', browserSecret: 'secret-2', expiresAt: new Date('2026-10-21T09:10:00.000Z') }]);
  });

  it.each([
    { what: 'no page', returnTo: undefined },
    { what: 'another site', returnTo: 'https://evil.example.com/overview' },
    { what: 'another site without a scheme', returnTo: '//evil.example.com/overview' },
    { what: 'another site behind a backslash', returnTo: '/\\evil.example.com' },
  ])('goes back to the Overview for $what', ({ returnTo }) => {
    startSignIn()({ returnTo });

    expect([...seals.held.values()].map((signIn) => signIn.returnTo)).toEqual(['/overview']);
  });
});

describe('pagasae sends the person back', () => {
  it('goes back to the page asked for once pagasae redeems its code', async () => {
    expect(await completeSignIn()(started('/overview?fleet=flt_1'))).toEqual({ isOk: true, value: { redirectTo: '/overview?fleet=flt_1' } });
  });

  it('refuses a state the gateway did not seal', async () => {
    started();

    expect(await completeSignIn()({ state: 'sealed-9', code: 'pagasae-code-1', browserSecret: 'secret-2' })).toEqual({ isOk: false, error: { kind: 'unknownSignIn' } });
  });

  it('refuses a sign-in whose 10 minutes passed', async () => {
    const back = started();
    now = new Date('2026-10-21T09:10:00.000Z');

    expect(await completeSignIn()(back)).toEqual({ isOk: false, error: { kind: 'unknownSignIn' } });
  });

  it('refuses a browser that does not hold the secret the start drew', async () => {
    const back = started();

    expect(await completeSignIn()({ ...back, browserSecret: 'secret-9' })).toEqual({ isOk: false, error: { kind: 'otherBrowser' } });
  });

  it('says what pagasae said when it sent no code', async () => {
    const back = started();

    expect(await completeSignIn()({ state: back.state, browserSecret: back.browserSecret, error: 'access_denied' })).toEqual({ isOk: false, error: { kind: 'pagasaeRefused', message: 'access_denied' } });
  });

  it('says why when pagasae does not redeem its code', async () => {
    const back = started();

    expect(await completeSignIn(fakeSharedSignIn({ code: { code: 'pagasae-code-1', verifier: 'secret-9' } }))(back)).toEqual({ isOk: false, error: { kind: 'pagasaeRefused', message: 'invalid_grant' } });
  });
});

describe('a person signs out', () => {
  it('ends the shared sign-in at pagasae, so every app is signed out', async () => {
    const signIns = fakeSharedSignIn({});

    expect(await createSignOutAccount({ signIns })(CHARLOTTE_SIGN_IN)).toEqual({ isOk: true, value: undefined });
    expect(signIns.revoked).toEqual([CHARLOTTE_SIGN_IN]);
  });

  it('says so when pagasae does not answer, so the person can try again', async () => {
    expect(await createSignOutAccount({ signIns: fakeSharedSignIn({ isAvailable: false }) })(CHARLOTTE_SIGN_IN)).toEqual({ isOk: false, error: { kind: 'unavailable' } });
  });
});
