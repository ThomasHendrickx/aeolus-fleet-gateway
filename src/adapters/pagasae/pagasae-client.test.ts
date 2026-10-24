import { createServer, type IncomingMessage, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPagasae } from './pagasae-client.js';

const FLEET = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const PERSON_SHIP = 'shp_01m3tb1zgr5h2ffee12xnch8pp';
const REDIRECT_URI = 'https://gateway.example.com/pagasae/callback';
const SECRET = 'g'.repeat(32);

/** An account token as pagasae signs it; the gateway reads it, core checks its signature. */
function anAccountToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'EdDSA', typ: 'at+jwt', kid: 'k1' })}.${part(claims)}.c2lnbmF0dXJl`;
}

/**
 * Every claim core checks on an account token (aeolus-fleet common's
 * accountTokenClaimsSchema, decision 0058), as pagasae signs them. The
 * gateway reads its own few of them until that schema is published
 * (aeolus-fleet#991).
 */
const CHARLOTTE = { iss: 'https://pagasae.example.com', aud: FLEET, sub: 'acc-charlotte', org: 'org-acme', scope: 'fleet:read gateway:approve', group: ['sales'], person_ship: PERSON_SHIP, iat: 1_792_400_000, exp: 1_792_400_600 };

let server: Server;
let base: string;
let received: { url: string | undefined; form: URLSearchParams }[];
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
  answer = { status: 200, body: { access_token: anAccountToken(CHARLOTTE), token_type: 'Bearer', expires_in: 600, refresh_token: 'pagasae-refresh-1', id_token: 'an-id-token' } };
  server = createServer((request, response) => {
    void formOf(request).then((form) => {
      received.push({ url: request.url, form });
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

function pagasae() {
  return createPagasae({ url: base, clientId: 'gateway', clientSecret: SECRET, redirectUri: REDIRECT_URI, timeoutMs: 1000 });
}

describe("pagasae's authorize address for the gateway", () => {
  it('asks for a code with PKCE S256, sending the person back to the gateway, naming no fleet', () => {
    const url = new URL(pagasae().authorizeUrl({ state: 'sealed-1', codeChallenge: 'challenge-1' }));

    expect({ at: `${url.origin}${url.pathname}`, query: Object.fromEntries(url.searchParams) }).toEqual({
      at: `${base}/oauth/authorize`,
      query: { response_type: 'code', client_id: 'gateway', redirect_uri: REDIRECT_URI, code_challenge: 'challenge-1', code_challenge_method: 'S256', state: 'sealed-1', scope: 'openid' },
    });
  });
});

describe('redeeming the code pagasae sent the person back with', () => {
  it("posts the code, the verifier and the gateway's secret to pagasae's token endpoint", async () => {
    await pagasae().redeemCode({ code: 'pagasae-code-1', verifier: 'verifier-1' });

    expect(received.map(({ url, form }) => ({ url, form: Object.fromEntries(form) }))).toEqual([
      {
        url: '/oauth/token',
        form: { grant_type: 'authorization_code', code: 'pagasae-code-1', redirect_uri: REDIRECT_URI, code_verifier: 'verifier-1', client_id: 'gateway', client_secret: SECRET },
      },
    ]);
  });

  it('answers the account token, the refresh token, and the fleet, account, person ship and scopes the token names', async () => {
    await expect(pagasae().redeemCode({ code: 'pagasae-code-1', verifier: 'verifier-1' })).resolves.toEqual({
      isOk: true,
      value: {
        accountToken: anAccountToken(CHARLOTTE),
        accountTokenExpiresAt: new Date(1_792_400_600_000),
        refreshToken: 'pagasae-refresh-1',
        fleetId: FLEET,
        accountId: 'acc-charlotte',
        personShipId: PERSON_SHIP,
        scopes: ['fleet:read', 'gateway:approve'],
      },
    });
  });

  it.each([
    ['an audience that is no fleet id', { aud: 'acme' }],
    ['a person ship that is no ship id', { person_ship: 'person-charlotte' }],
    ['no subject', { sub: '' }],
    ['no end', { exp: undefined }],
    ['no scope claim', { scope: undefined }],
    ['a core scope that does not exist', { scope: 'fleet:read fleet:everything' }],
    ['no organisation', { org: '' }],
    ['no issue time', { iat: undefined }],
  ])('answers that the account token could not be read for %s, as core would refuse it', async (_what, claims) => {
    answer = { status: 200, body: { access_token: anAccountToken({ ...CHARLOTTE, ...claims }), token_type: 'Bearer', expires_in: 600, refresh_token: 'r' } };

    await expect(pagasae().redeemCode({ code: 'pagasae-code-1', verifier: 'verifier-1' })).resolves.toMatchObject({ isOk: false });
  });

  it('answers no person ship for an account with none', async () => {
    const withoutShip = Object.fromEntries(Object.entries(CHARLOTTE).filter(([claim]) => claim !== 'person_ship'));
    answer = { status: 200, body: { ...(typeof answer.body === 'object' ? answer.body : {}), access_token: anAccountToken(withoutShip) } };

    await expect(pagasae().redeemCode({ code: 'pagasae-code-1', verifier: 'verifier-1' })).resolves.toMatchObject({ isOk: true, value: { personShipId: null } });
  });

  it('answers no scopes for a token whose scope claim is empty', async () => {
    answer = { status: 200, body: { ...(typeof answer.body === 'object' ? answer.body : {}), access_token: anAccountToken({ ...CHARLOTTE, scope: '' }) } };

    await expect(pagasae().redeemCode({ code: 'pagasae-code-1', verifier: 'verifier-1' })).resolves.toMatchObject({ isOk: true, value: { scopes: [] } });
  });

  it("answers pagasae's error", async () => {
    answer = { status: 400, body: { error: 'invalid_grant' } };

    await expect(pagasae().redeemCode({ code: 'pagasae-code-1', verifier: 'verifier-1' })).resolves.toEqual({ isOk: false, error: { reason: 'invalid_grant' } });
  });

  it('answers that the account token could not be read when it is no account token', async () => {
    answer = { status: 200, body: { access_token: 'not-a-jwt', token_type: 'Bearer', expires_in: 600, refresh_token: 'r' } };

    await expect(pagasae().redeemCode({ code: 'pagasae-code-1', verifier: 'verifier-1' })).resolves.toMatchObject({ isOk: false });
  });

  it('answers that pagasae did not answer', async () => {
    const unreachable = createPagasae({ url: 'http://127.0.0.1:1', clientId: 'gateway', clientSecret: SECRET, redirectUri: REDIRECT_URI, timeoutMs: 1000 });

    await expect(unreachable.redeemCode({ code: 'pagasae-code-1', verifier: 'verifier-1' })).resolves.toMatchObject({ isOk: false });
  });
});

describe("refreshing a person's account token at pagasae", () => {
  it("posts the refresh token and the gateway's secret to pagasae's token endpoint", async () => {
    await pagasae().refresh('pagasae-refresh-1');

    expect(received.map(({ url, form }) => ({ url, form: Object.fromEntries(form) }))).toEqual([
      { url: '/oauth/token', form: { grant_type: 'refresh_token', refresh_token: 'pagasae-refresh-1', client_id: 'gateway', client_secret: SECRET } },
    ]);
  });

  it('answers the new account token and refresh token, and what the token names', async () => {
    await expect(pagasae().refresh('pagasae-refresh-1')).resolves.toMatchObject({ isOk: true, value: { accountToken: anAccountToken(CHARLOTTE), refreshToken: 'pagasae-refresh-1', fleetId: FLEET, personShipId: PERSON_SHIP } });
  });

  it("answers refused for pagasae's invalid_grant: the grant ended", async () => {
    answer = { status: 400, body: { error: 'invalid_grant' } };

    await expect(pagasae().refresh('pagasae-refresh-1')).resolves.toEqual({ isOk: false, error: { kind: 'refused', reason: 'invalid_grant' } });
  });

  it('answers unavailable when pagasae does not answer, or answers 5xx', async () => {
    answer = { status: 503, body: {} };
    const unreachable = createPagasae({ url: 'http://127.0.0.1:1', clientId: 'gateway', clientSecret: SECRET, redirectUri: REDIRECT_URI, timeoutMs: 1000 });

    await expect(Promise.all([pagasae().refresh('pagasae-refresh-1'), unreachable.refresh('pagasae-refresh-1')])).resolves.toMatchObject([
      { isOk: false, error: { kind: 'unavailable' } },
      { isOk: false, error: { kind: 'unavailable' } },
    ]);
  });
});

describe("handing a client's ID-JAG over to pagasae (company sign-in design, slice 6)", () => {
  it("posts it as a token exchange naming the client, with the gateway's secret", async () => {
    await pagasae().exchangeIdJag({ idJag: 'an-id-jag', clientId: 'client-claude' });

    expect(received.map(({ url, form }) => ({ url, form: Object.fromEntries(form) }))).toEqual([
      {
        url: '/oauth/token',
        form: {
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          subject_token_type: 'urn:ietf:params:oauth:token-type:id-jag',
          subject_token: 'an-id-jag',
          id_jag_client_id: 'client-claude',
          client_id: 'gateway',
          client_secret: SECRET,
        },
      },
    ]);
  });

  it("answers the account's grant: its account token, refresh token, and what the token names", async () => {
    await expect(pagasae().exchangeIdJag({ idJag: 'an-id-jag', clientId: 'client-claude' })).resolves.toMatchObject({
      isOk: true,
      value: { accountToken: anAccountToken(CHARLOTTE), refreshToken: 'pagasae-refresh-1', fleetId: FLEET, accountId: 'acc-charlotte' },
    });
  });

  it("answers refused for pagasae's invalid_grant", async () => {
    answer = { status: 400, body: { error: 'invalid_grant' } };

    await expect(pagasae().exchangeIdJag({ idJag: 'an-id-jag', clientId: 'client-claude' })).resolves.toEqual({ isOk: false, error: { kind: 'refused', reason: 'invalid_grant' } });
  });
});
