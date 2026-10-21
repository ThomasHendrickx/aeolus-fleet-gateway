import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CHARLOTTE_SIGN_IN, fakeAccountSignInSeals, fakeSharedSignIn } from '../../../test/support/account-sign-in-fakes.js';
import { fakeSecrets } from '../../../test/support/oauth-fakes.js';
import { PAGASAE_URL } from '../../../test/support/sign-in-fakes.js';
import { createCompleteAccountSignIn } from '../../core/account-sign-in/complete-account-sign-in.js';
import { createSignOutAccount } from '../../core/account-sign-in/sign-out-account.js';
import { createStartAccountSignIn } from '../../core/account-sign-in/start-account-sign-in.js';
import { registerAccountSignIn } from './account-sign-in-routes.js';

// The doors of the shared account sign-in for the gateway's pages (header
// design H5): /sign-in/start sends the browser to pagasae, /sign-in/done
// takes it back, and /sign-in/end signs it out of every Aeolus app.

const ISSUER = 'https://gateway.example.com';

let server: FastifyInstance;
let signIns: ReturnType<typeof fakeSharedSignIn>;

beforeEach(async () => {
  const clock = { now: () => new Date('2026-10-21T09:00:00.000Z') };
  const seals = fakeAccountSignInSeals();
  signIns = fakeSharedSignIn({ code: { code: 'pagasae-code-1', verifier: 'secret-1' } });
  server = Fastify({ logger: false });
  registerAccountSignIn(server, {
    issuer: ISSUER,
    start: createStartAccountSignIn({ seals, signIns, secrets: fakeSecrets(), clock }),
    complete: createCompleteAccountSignIn({ seals, signIns, clock }),
    signOut: createSignOutAccount({ signIns }),
  });
  await server.ready();
});

afterEach(async () => {
  await server.close();
});

describe('signing in to the pages', () => {
  it("sends the browser to pagasae, holding the sign-in's secret in a cookie only the way back reads", async () => {
    const started = await server.inject({ url: '/sign-in/start?return_to=%2Foverview%3Ffleet%3Dflt_1' });

    expect({ status: started.statusCode, location: started.headers.location, cookie: started.headers['set-cookie'] }).toEqual({
      status: 302,
      location: `${PAGASAE_URL}/oauth/authorize?state=sealed-1&code_challenge=S256(secret-1)`,
      cookie: 'aeolus_account_sign_in=secret-2; Path=/sign-in/done; Max-Age=600; HttpOnly; Secure; SameSite=Lax',
    });
  });

  it('goes back to the page asked for, clearing the cookie', async () => {
    await server.inject({ url: '/sign-in/start?return_to=%2Foverview%3Ffleet%3Dflt_1' });

    const back = await server.inject({ url: '/sign-in/done?state=sealed-1&code=pagasae-code-1', headers: { cookie: 'aeolus_account_sign_in=secret-2' } });

    expect({ status: back.statusCode, location: back.headers.location, cookie: back.headers['set-cookie'] }).toEqual({
      status: 302,
      location: '/overview?fleet=flt_1',
      cookie: 'aeolus_account_sign_in=; Path=/sign-in/done; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
    });
  });

  it.each([
    { what: 'a browser without the secret', cookie: 'aeolus_account_sign_in=secret-9', reason: 'otherBrowser' },
    { what: 'an unknown sign-in', cookie: 'aeolus_account_sign_in=secret-2', state: 'sealed-9', reason: 'unknownSignIn' },
  ])("sends $what to the web app's page that says why", async ({ cookie, state, reason }) => {
    await server.inject({ url: '/sign-in/start' });

    const back = await server.inject({ url: `/sign-in/done?state=${state ?? 'sealed-1'}&code=pagasae-code-1`, headers: { cookie } });

    expect({ status: back.statusCode, location: back.headers.location }).toEqual({ status: 302, location: `/sign-in/failed?reason=${reason}` });
  });
});

describe('signing out', () => {
  it('ends the shared sign-in the browser holds, then starts a new sign-in', async () => {
    const out = await server.inject({ method: 'POST', url: '/sign-in/end', headers: { origin: 'http://localhost:80', host: 'localhost:80', cookie: `theme=dark; aeolus_account_session=${CHARLOTTE_SIGN_IN}` } });

    expect({ status: out.statusCode, location: out.headers.location, revoked: signIns.revoked }).toEqual({ status: 303, location: '/sign-in/start', revoked: [CHARLOTTE_SIGN_IN] });
  });

  it('refuses a sign-out sent from another site', async () => {
    const out = await server.inject({ method: 'POST', url: '/sign-in/end', headers: { origin: 'https://evil.example.com', host: 'localhost:80', cookie: `aeolus_account_session=${CHARLOTTE_SIGN_IN}` } });

    expect({ status: out.statusCode, revoked: signIns.revoked }).toEqual({ status: 403, revoked: [] });
  });
});
