import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSharedSignIn } from './shared-sign-in.js';

const FLEET = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const PERSON_SHIP = 'shp_01m3tb1zgr5h2ffee12xnch8pp';
const REDIRECT_URI = 'https://gateway.example.com/sign-in/done';
const SECRET = 'g'.repeat(32);
const SIGN_IN = 'charlotte-sign-in';

/** An account token as pagasae signs it; the gateway reads it, core checks its signature. */
function anAccountToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'EdDSA', typ: 'at+jwt', kid: 'k1' })}.${part(claims)}.c2lnbmF0dXJl`;
}

/** Every claim core checks on an account token (common's accountTokenClaimsSchema, decision 0058). */
const CHARLOTTE = { iss: 'https://pagasae.example.com', aud: FLEET, sub: 'acc-charlotte', org: 'org-acme', scope: 'fleet:read gateway:approve', group: ['sales'], person_ship: PERSON_SHIP, iat: 1_792_400_000, exp: 1_792_400_600 };

let server: Server;
let base: string;
let received: { method: string | undefined; url: string | undefined; headers: IncomingHttpHeaders; form: URLSearchParams }[];
let answer: { status: number; body: unknown };

async function formOf(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

beforeEach(async () => {
  received = [];
  answer = { status: 200, body: {} };
  server = createServer((request, response) => {
    void formOf(request).then((form) => {
      received.push({ method: request.method, url: request.url, headers: request.headers, form });
      response.writeHead(answer.status, { 'content-type': 'application/json' }).end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function signIns() {
  return createSharedSignIn({ url: base, clientId: 'gateway', clientSecret: SECRET, redirectUri: REDIRECT_URI, timeoutMs: 1000 });
}

describe("pagasae's sign-in for the gateway's pages, an app of its (H5)", () => {
  it('asks for a code with PKCE S256, sending the person back to the pages, naming no fleet', () => {
    const url = new URL(signIns().authorizeUrl({ state: 'sealed-1', codeChallenge: 'challenge-1' }));

    expect({ at: `${url.origin}${url.pathname}`, query: Object.fromEntries(url.searchParams) }).toEqual({
      at: `${base}/oauth/authorize`,
      query: { response_type: 'code', client_id: 'gateway', redirect_uri: REDIRECT_URI, code_challenge: 'challenge-1', code_challenge_method: 'S256', state: 'sealed-1', scope: 'openid' },
    });
  });

  it("redeems the code with the verifier and the app's secret", async () => {
    answer = { status: 200, body: { id_token: 'an-id-token', token_type: 'Bearer', expires_in: 600 } };

    expect(await signIns().redeemCode({ code: 'code-1', verifier: 'verifier-1' })).toEqual({ isOk: true, value: undefined });
    expect(Object.fromEntries(received[0]?.form ?? [])).toEqual({ grant_type: 'authorization_code', code: 'code-1', redirect_uri: REDIRECT_URI, code_verifier: 'verifier-1', client_id: 'gateway', client_secret: SECRET });
  });

  it('says why pagasae did not redeem the code', async () => {
    answer = { status: 400, body: { error: 'invalid_grant' } };

    expect(await signIns().redeemCode({ code: 'code-1', verifier: 'verifier-1' })).toEqual({ isOk: false, error: { reason: 'invalid_grant' } });
  });
});

describe('the account token of a fleet, exchanged for the shared sign-in (RFC 8693)', () => {
  it('asks the token exchange for the fleet, and reads the account, person ship, scopes and end the token names', async () => {
    answer = { status: 200, body: { access_token: anAccountToken(CHARLOTTE), issued_token_type: 'urn:ietf:params:oauth:token-type:jwt', token_type: 'Bearer', expires_in: 600 } };

    const exchanged = await signIns().accountToken({ signIn: SIGN_IN, fleetId: FLEET });

    expect(exchanged).toEqual({ isOk: true, value: { accountToken: anAccountToken(CHARLOTTE), endsAt: new Date(1_792_400_600_000), accountId: 'acc-charlotte', personShipId: PERSON_SHIP, scopes: ['fleet:read', 'gateway:approve'] } });
    expect({ url: received[0]?.url, form: Object.fromEntries(received[0]?.form ?? []) }).toEqual({
      url: '/oauth/token',
      form: {
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: SIGN_IN,
        subject_token_type: 'urn:aeolus:params:oauth:token-type:sign-in',
        resource: FLEET,
        client_id: 'gateway',
        client_secret: SECRET,
      },
    });
  });

  it.each([
    { error: 'invalid_grant', status: 400, kind: 'signedOut' },
    { error: 'invalid_target', status: 400, kind: 'noRights' },
  ])('answers $kind when pagasae says $error', async ({ error, status, kind }) => {
    answer = { status, body: { error } };

    expect(await signIns().accountToken({ signIn: SIGN_IN, fleetId: FLEET })).toEqual({ isOk: false, error: { kind } });
  });

  it('answers unavailable when pagasae fails', async () => {
    answer = { status: 503, body: {} };

    expect(await signIns().accountToken({ signIn: SIGN_IN, fleetId: FLEET })).toEqual({ isOk: false, error: { kind: 'unavailable' } });
  });

  it("fails loudly when pagasae does not know the gateway's credentials, a setting to fix", async () => {
    answer = { status: 401, body: { error: 'invalid_client' } };

    await expect(signIns().accountToken({ signIn: SIGN_IN, fleetId: FLEET })).rejects.toThrow('pagasae refused the gateway\'s app credentials (invalid_client)');
  });
});

describe('the apps and fleets the account may open (H1)', () => {
  it("asks with the app's Basic credentials and the shared sign-in, and reads each fleet's apps", async () => {
    answer = {
      status: 200,
      body: {
        account: { id: 'acc-charlotte', email: 'charlotte@example.com' },
        apps: [{ app: 'account', url: 'https://account.example.com/account' }],
        fleets: [{ id: FLEET, name: 'Acme', argo: false, apps: [{ app: 'gateway', url: 'https://gateway.example.com' }] }],
      },
    };

    expect(await signIns().apps(SIGN_IN)).toEqual({
      isOk: true,
      value: { apps: [{ app: 'account', url: 'https://account.example.com/account' }], fleets: [{ fleetId: FLEET, apps: [{ app: 'gateway', url: 'https://gateway.example.com' }] }] },
    });
    expect({ method: received[0]?.method, url: received[0]?.url, authorization: received[0]?.headers.authorization, signIn: received[0]?.headers['aeolus-sign-in'] }).toEqual({
      method: 'GET',
      url: '/api/apps',
      authorization: `Basic ${Buffer.from(`gateway:${SECRET}`).toString('base64')}`,
      signIn: SIGN_IN,
    });
  });

  it('answers signedOut for a sign-in that ended', async () => {
    answer = { status: 401, body: { error: 'invalid_grant' } };

    expect(await signIns().apps(SIGN_IN)).toEqual({ isOk: false, error: { kind: 'signedOut' } });
  });
});

describe('signing out (RFC 7009)', () => {
  it("revokes the shared sign-in with the app's secret", async () => {
    expect(await signIns().revoke(SIGN_IN)).toEqual({ isOk: true, value: undefined });
    expect({ url: received[0]?.url, form: Object.fromEntries(received[0]?.form ?? []) }).toEqual({ url: '/oauth/revoke', form: { token: SIGN_IN, client_id: 'gateway', client_secret: SECRET } });
  });

  it('answers unavailable when pagasae fails', async () => {
    answer = { status: 500, body: {} };

    expect(await signIns().revoke(SIGN_IN)).toEqual({ isOk: false, error: { kind: 'unavailable' } });
  });
});
