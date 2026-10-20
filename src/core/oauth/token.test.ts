import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeSecrets, memoryAuthorizationCodes, memoryIssuedTokens, memoryOAuthClients, RESOURCE } from '../../../test/support/oauth-fakes.js';
import { createAuthenticateAccessToken } from './authenticate-access-token.js';
import { createExchangeToken } from './exchange-token.js';

const CIMD_CLIENT = 'https://claude.example.com/oauth/client.json';
const CALLBACK = 'https://claude.example.com/callback';
const ISSUED_AT = new Date('2026-10-19T09:00:00.000Z');

let now: Date;
let clients: ReturnType<typeof memoryOAuthClients>;
let codes: ReturnType<typeof memoryAuthorizationCodes>;
let tokens: ReturnType<typeof memoryIssuedTokens>;
let exchangeToken: ReturnType<typeof createExchangeToken>;
let authenticate: ReturnType<typeof createAuthenticateAccessToken>;

beforeEach(async () => {
  now = ISSUED_AT;
  const clock = { now: () => now };
  const secrets = fakeSecrets();
  clients = memoryOAuthClients();
  await clients.save({ clientId: 'client-cursor', fleetId: FLEET_ID, name: 'Cursor', redirectUris: ['https://cursor.example.com/callback'], secretHash: 'hash(cursor-secret)' });
  codes = memoryAuthorizationCodes();
  await codes.save({ codeHash: 'hash(code-1)', fleetId: FLEET_ID, clientId: CIMD_CLIENT, redirectUri: CALLBACK, codeChallenge: 'S256(verifier-1)', resource: RESOURCE, scope: null, kind: 'party', party: 'claude', expiresAt: new Date('2026-10-19T09:01:00.000Z') });
  await codes.save({ codeHash: 'hash(code-2)', fleetId: FLEET_ID, clientId: 'client-cursor', redirectUri: 'https://cursor.example.com/callback', codeChallenge: 'S256(verifier-2)', resource: RESOURCE, scope: null, kind: 'party', party: 'cursor', expiresAt: new Date('2026-10-19T09:01:00.000Z') });
  await codes.save({ codeHash: 'hash(code-3)', fleetId: FLEET_ID, clientId: CIMD_CLIENT, redirectUri: CALLBACK, codeChallenge: 'S256(verifier-3)', resource: RESOURCE, scope: null, kind: 'account', grantId: 'grant-1', expiresAt: new Date('2026-10-19T09:01:00.000Z') });
  tokens = memoryIssuedTokens();
  exchangeToken = createExchangeToken({ clients, codes, tokens, secrets, clock, resource: RESOURCE });
  authenticate = createAuthenticateAccessToken({ tokens, secrets, clock, resource: RESOURCE });
});

/** A token request for the CIMD client's code, as it sends it to /token. */
function aCodeGrant(overrides: Record<string, string | undefined> = {}) {
  return { grant_type: 'authorization_code', code: 'code-1', redirect_uri: CALLBACK, code_verifier: 'verifier-1', client_id: CIMD_CLIENT, resource: RESOURCE, ...overrides };
}

const FIRST_PAIR = { accessToken: 'secret-1', refreshToken: 'secret-2', expiresInSeconds: 3600, scope: null };

describe('a client takes its code for tokens (OAuth 2.1 with PKCE)', () => {
  it('answers an access token and a refresh token, kept only as hashes', async () => {
    await expect(exchangeToken(aCodeGrant())).resolves.toEqual({ isOk: true, value: FIRST_PAIR });
    expect(tokens.held.map(({ accessHash, refreshHash, state }) => [accessHash, refreshHash, state])).toEqual([['hash(secret-1)', 'hash(secret-2)', 'active']]);
  });

  it('takes a confidential client with its secret', async () => {
    await expect(exchangeToken({ ...aCodeGrant({ code: 'code-2', code_verifier: 'verifier-2', redirect_uri: 'https://cursor.example.com/callback', client_id: 'client-cursor' }), client_secret: 'cursor-secret' })).resolves.toMatchObject({ isOk: true });
  });

  it.each([
    ['a wrong secret', { client_secret: 'wrong' }],
    ['no secret', { client_secret: undefined }],
  ])('refuses a confidential client with %s', async (_what, secret) => {
    await expect(exchangeToken({ ...aCodeGrant({ code: 'code-2', code_verifier: 'verifier-2', redirect_uri: 'https://cursor.example.com/callback', client_id: 'client-cursor' }), ...secret })).resolves.toMatchObject({
      isOk: false,
      error: { error: 'invalid_client' },
    });
  });

  it.each([
    { what: 'an unknown code', overrides: { code: 'code-9' }, error: 'invalid_grant' },
    { what: 'the wrong verifier', overrides: { code_verifier: 'verifier-9' }, error: 'invalid_grant' },
    { what: 'another redirect URI', overrides: { redirect_uri: 'https://claude.example.com/other' }, error: 'invalid_grant' },
    { what: "another client's code", overrides: { client_id: 'https://other.example.com/client.json' }, error: 'invalid_grant' },
    { what: 'another resource', overrides: { resource: 'https://other.example.com/mcp' }, error: 'invalid_target' },
    { what: 'no verifier', overrides: { code_verifier: undefined }, error: 'invalid_request' },
    { what: 'another grant type', overrides: { grant_type: 'password' }, error: 'unsupported_grant_type' },
  ])('refuses $what', async ({ overrides, error }) => {
    await expect(exchangeToken(aCodeGrant(overrides))).resolves.toMatchObject({ isOk: false, error: { error } });
    expect(tokens.held).toEqual([]);
  });

  it('refuses a code one minute after it was issued', async () => {
    now = new Date('2026-10-19T09:01:00.000Z');

    await expect(exchangeToken(aCodeGrant())).resolves.toMatchObject({ isOk: false, error: { error: 'invalid_grant' } });
  });

  it('takes a code just before its minute ends', async () => {
    now = new Date('2026-10-19T09:00:59.999Z');

    await expect(exchangeToken(aCodeGrant())).resolves.toMatchObject({ isOk: true });
  });

  it('refuses a code used before, and revokes the tokens it gave (OAuth 2.1, 4.1.3)', async () => {
    await exchangeToken(aCodeGrant());

    await expect(exchangeToken(aCodeGrant())).resolves.toMatchObject({ isOk: false, error: { error: 'invalid_grant' } });
    await expect(authenticate('secret-1')).resolves.toMatchObject({ isOk: false });
  });
});

describe('a client refreshes its tokens', () => {
  it('keeps the party of the code it came from', async () => {
    await exchangeToken(aCodeGrant());
    await exchangeToken({ grant_type: 'refresh_token', refresh_token: 'secret-2', client_id: CIMD_CLIENT });

    await expect(authenticate('secret-3')).resolves.toMatchObject({ isOk: true, value: { kind: 'party', party: 'claude' } });
  });

  it('rotates them: a new pair, and the old refresh token no longer works', async () => {
    await exchangeToken(aCodeGrant());

    await expect(exchangeToken({ grant_type: 'refresh_token', refresh_token: 'secret-2', client_id: CIMD_CLIENT })).resolves.toEqual({
      isOk: true,
      value: { accessToken: 'secret-3', refreshToken: 'secret-4', expiresInSeconds: 3600, scope: null },
    });
  });

  it('revokes the whole family when a rotated refresh token comes again: it was stolen, or the client lost its answer', async () => {
    await exchangeToken(aCodeGrant());
    await exchangeToken({ grant_type: 'refresh_token', refresh_token: 'secret-2', client_id: CIMD_CLIENT });

    await expect(exchangeToken({ grant_type: 'refresh_token', refresh_token: 'secret-2', client_id: CIMD_CLIENT })).resolves.toMatchObject({ isOk: false, error: { error: 'invalid_grant' } });
    await expect(authenticate('secret-3')).resolves.toMatchObject({ isOk: false });
  });

  it("refuses another client's refresh token", async () => {
    await exchangeToken(aCodeGrant());

    await expect(exchangeToken({ grant_type: 'refresh_token', refresh_token: 'secret-2', client_id: 'client-cursor', client_secret: 'cursor-secret' })).resolves.toMatchObject({ isOk: false, error: { error: 'invalid_grant' } });
  });

  it('refuses a refresh token 30 days after it was issued', async () => {
    await exchangeToken(aCodeGrant());
    now = new Date('2026-11-18T09:00:00.000Z');

    await expect(exchangeToken({ grant_type: 'refresh_token', refresh_token: 'secret-2', client_id: CIMD_CLIENT })).resolves.toMatchObject({ isOk: false, error: { error: 'invalid_grant' } });
  });
});

describe('the gateway knows the caller by its access token (RFC 8707: bound to the gateway)', () => {
  it("names the token's fleet, client and party: the proxy ship it calls the fleet as", async () => {
    await exchangeToken(aCodeGrant());

    await expect(authenticate('secret-1')).resolves.toEqual({ isOk: true, value: { fleetId: FLEET_ID, clientId: CIMD_CLIENT, kind: 'party', party: 'claude', scope: null } });
  });

  it("names the account grant of a person who signed in through pagasae, whose code holds it (decision 0054)", async () => {
    await exchangeToken(aCodeGrant({ code: 'code-3', code_verifier: 'verifier-3' }));

    await expect(authenticate('secret-1')).resolves.toEqual({ isOk: true, value: { fleetId: FLEET_ID, clientId: CIMD_CLIENT, kind: 'account', grantId: 'grant-1', scope: null } });
  });

  it('keeps the account grant across a refresh', async () => {
    await exchangeToken(aCodeGrant({ code: 'code-3', code_verifier: 'verifier-3' }));
    await exchangeToken({ grant_type: 'refresh_token', refresh_token: 'secret-2', client_id: CIMD_CLIENT });

    await expect(authenticate('secret-3')).resolves.toMatchObject({ isOk: true, value: { kind: 'account', grantId: 'grant-1' } });
  });

  it('refuses an unknown token', async () => {
    await expect(authenticate('secret-9')).resolves.toMatchObject({ isOk: false, error: { kind: 'invalidToken' } });
  });

  it('refuses an access token one hour after it was issued, and takes it just before', async () => {
    await exchangeToken(aCodeGrant());
    now = new Date('2026-10-19T09:59:59.999Z');
    await expect(authenticate('secret-1')).resolves.toMatchObject({ isOk: true });

    now = new Date('2026-10-19T10:00:00.000Z');
    await expect(authenticate('secret-1')).resolves.toMatchObject({ isOk: false });
  });

  it('refuses an access token whose refresh token was rotated: the new pair replaces it', async () => {
    await exchangeToken(aCodeGrant());
    await exchangeToken({ grant_type: 'refresh_token', refresh_token: 'secret-2', client_id: CIMD_CLIENT });

    await expect(authenticate('secret-1')).resolves.toMatchObject({ isOk: false });
  });
});
