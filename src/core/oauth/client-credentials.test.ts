import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeSecrets, memoryAuthorizationCodes, memoryIssuedTokens, memoryOAuthClients, RESOURCE } from '../../../test/support/oauth-fakes.js';
import { memoryPartyStore, PROXY_SHIP_ID } from '../../../test/support/party-fakes.js';
import { createAuthenticateAccessToken } from './authenticate-access-token.js';
import { createExchangeToken } from './exchange-token.js';

// A client party with no human at the authorize step, as a vendor agent such
// as AgentCore is, signs in with OAuth client credentials (vendor platforms V4).

const ISSUED_AT = new Date('2026-10-23T09:00:00.000Z');

let now: Date;
let isOutsidePartiesOn: boolean;
let parties: ReturnType<typeof memoryPartyStore>;
let tokens: ReturnType<typeof memoryIssuedTokens>;
let exchangeToken: ReturnType<typeof createExchangeToken>;
let authenticate: ReturnType<typeof createAuthenticateAccessToken>;

beforeEach(async () => {
  now = ISSUED_AT;
  isOutsidePartiesOn = true;
  const clock = { now: () => now };
  const secrets = fakeSecrets();
  const clients = memoryOAuthClients();
  await clients.save({ clientId: 'client-agentcore', fleetId: FLEET_ID, name: 'agentcore', redirectUris: [], secretHash: 'hash(agentcore-secret)', grant: 'clientCredentials' });
  await clients.save({ clientId: 'client-cursor', fleetId: FLEET_ID, name: 'Cursor', redirectUris: ['https://cursor.example.com/callback'], secretHash: 'hash(cursor-secret)', grant: 'authorizationCode' });
  parties = memoryPartyStore();
  const approved = { fleetId: FLEET_ID, kind: 'mcpClient', state: 'crewed', proxyShipId: PROXY_SHIP_ID, secret: null, crewToken: 'aeolus_ct_v1_proxy', requestHash: 'h', approvedAt: ISSUED_AT } as const;
  await parties.save({ ...approved, name: 'agentcore', clientId: 'client-agentcore', requestId: 'r-1' });
  await parties.save({ ...approved, name: 'cursor', clientId: 'client-cursor', requestId: 'r-2' });
  tokens = memoryIssuedTokens();
  const servesOutsideParties = () => Promise.resolve(isOutsidePartiesOn);
  exchangeToken = createExchangeToken({ clients, codes: memoryAuthorizationCodes(), tokens, secrets, clock, resource: RESOURCE, parties, servesOutsideParties });
  authenticate = createAuthenticateAccessToken({ tokens, secrets, clock, resource: RESOURCE });
});

/** A token request as the machine client sends it, its credentials taken from client_secret_basic. */
function aClientCredentialsGrant(overrides: Record<string, string | undefined> = {}) {
  return { grant_type: 'client_credentials', client_id: 'client-agentcore', client_secret: 'agentcore-secret', resource: RESOURCE, ...overrides };
}

describe('a client party signs in with client credentials (vendor platforms V4)', () => {
  it('answers a one-hour access token and no refresh token, kept only as its hash', async () => {
    await expect(exchangeToken(aClientCredentialsGrant())).resolves.toEqual({ isOk: true, value: { accessToken: 'secret-1', refreshToken: null, expiresInSeconds: 3600, scope: null } });
    expect(tokens.held.map(({ accessHash, refreshHash, state }) => [accessHash, refreshHash, state])).toEqual([['hash(secret-1)', null, 'active']]);
  });

  it('names the party with its token: the proxy ship it calls the fleet as', async () => {
    await exchangeToken(aClientCredentialsGrant());

    await expect(authenticate('secret-1')).resolves.toEqual({ isOk: true, value: { fleetId: FLEET_ID, clientId: 'client-agentcore', scope: null, kind: 'party', party: 'agentcore' } });
  });

  it('refuses its token one hour after it was issued, and takes it just before', async () => {
    await exchangeToken(aClientCredentialsGrant());

    now = new Date('2026-10-23T09:59:59.999Z');
    await expect(authenticate('secret-1')).resolves.toMatchObject({ isOk: true });
    now = new Date('2026-10-23T10:00:00.000Z');
    await expect(authenticate('secret-1')).resolves.toMatchObject({ isOk: false });
  });

  it.each([
    { what: 'an unknown client', overrides: { client_id: 'client-unknown' } },
    { what: 'a wrong secret', overrides: { client_secret: 'wrong' } },
    { what: 'no secret', overrides: { client_secret: undefined } },
  ])('refuses $what with invalid_client', async ({ overrides }) => {
    await expect(exchangeToken(aClientCredentialsGrant(overrides))).resolves.toMatchObject({ isOk: false, error: { error: 'invalid_client' } });
    expect(tokens.held).toEqual([]);
  });

  it('refuses a retired party with invalid_client: its client stays, its party is gone', async () => {
    await parties.remove(FLEET_ID, 'agentcore');

    await expect(exchangeToken(aClientCredentialsGrant())).resolves.toMatchObject({ isOk: false, error: { error: 'invalid_client' } });
  });

  it("refuses with unauthorized_client while the fleet's outside parties are off (interop I-3)", async () => {
    isOutsidePartiesOn = false;

    await expect(exchangeToken(aClientCredentialsGrant())).resolves.toMatchObject({ isOk: false, error: { error: 'unauthorized_client' } });
    expect(tokens.held).toEqual([]);
  });

  it('refuses a client that signs in by authorization code with unauthorized_client', async () => {
    await expect(exchangeToken(aClientCredentialsGrant({ client_id: 'client-cursor', client_secret: 'cursor-secret' }))).resolves.toMatchObject({ isOk: false, error: { error: 'unauthorized_client' } });
  });

  it.each([
    { what: 'another resource', overrides: { resource: 'https://other.example.com/mcp' } },
    { what: 'no resource', overrides: { resource: undefined } },
  ])('refuses $what with invalid_target: a token is for the MCP endpoint only (RFC 8707)', async ({ overrides }) => {
    await expect(exchangeToken(aClientCredentialsGrant(overrides))).resolves.toMatchObject({ isOk: false, error: { error: 'invalid_target' } });
  });
});
