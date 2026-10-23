import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeSecrets, memoryAuthorizationCodes, memoryIssuedTokens, memoryOAuthClients, RESOURCE } from '../../../test/support/oauth-fakes.js';
import { memoryPartyStore } from '../../../test/support/party-fakes.js';
import { CHARLOTTE_TOKENS, fakePagasae, memoryAccountGrants } from '../../../test/support/sign-in-fakes.js';
import { createAuthenticateAccessToken } from './authenticate-access-token.js';
import { createExchangeIdJag } from './exchange-id-jag.js';
import { createExchangeToken } from './exchange-token.js';

/*
 * ID-JAG at the gateway (aeolus-fleet company sign-in design, slice 6, D7,
 * flow 3.2): a registered client posts the ID-JAG its person's company
 * identity provider issued, with the JWT bearer grant (RFC 7523); pagasae
 * checks it and answers the account's grant; the client gets an access
 * token acting as the account, as after a browser sign-in, and no refresh
 * token.
 */

const JWT_BEARER = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const ISSUED_AT = new Date('2026-10-23T09:00:00.000Z');

let clients: ReturnType<typeof memoryOAuthClients>;
let tokens: ReturnType<typeof memoryIssuedTokens>;
let grants: ReturnType<typeof memoryAccountGrants>;
let pagasae: ReturnType<typeof fakePagasae>;
let servedFleets: Set<string>;
let exchangeToken: ReturnType<typeof createExchangeToken>;
let authenticate: ReturnType<typeof createAuthenticateAccessToken>;

beforeEach(async () => {
  const clock = { now: () => ISSUED_AT };
  const secrets = fakeSecrets();
  clients = memoryOAuthClients();
  await clients.save({ clientId: 'client-claude', fleetId: FLEET_ID, name: 'Claude', redirectUris: ['https://claude.example.com/callback'], secretHash: 'hash(claude-secret)', grant: 'authorizationCode' });
  await clients.save({ clientId: 'client-public', fleetId: FLEET_ID, name: 'Public', redirectUris: ['https://public.example.com/callback'], secretHash: null, grant: 'authorizationCode' });
  await clients.save({ clientId: 'client-machine', fleetId: FLEET_ID, name: 'Machine', redirectUris: [], secretHash: 'hash(machine-secret)', grant: 'clientCredentials' });
  tokens = memoryIssuedTokens();
  grants = memoryAccountGrants();
  pagasae = fakePagasae({ refusal: 'unused' }, {}, { 'id-jag-charlotte': CHARLOTTE_TOKENS, 'id-jag-elsewhere': { ...CHARLOTTE_TOKENS, fleetId: OTHER_FLEET_ID }, 'id-jag-down': 'unavailable' });
  servedFleets = new Set([FLEET_ID, OTHER_FLEET_ID]);
  const exchangeIdJag = createExchangeIdJag({ clients, tokens, secrets, clock, resource: RESOURCE, pagasae, grants, servesFleet: (fleetId) => Promise.resolve(servedFleets.has(fleetId)) });
  exchangeToken = createExchangeToken({ clients, codes: memoryAuthorizationCodes(), tokens, secrets, clock, resource: RESOURCE, parties: memoryPartyStore(), servesOutsideParties: () => Promise.resolve(true), exchangeIdJag });
  authenticate = createAuthenticateAccessToken({ tokens, secrets, clock, resource: RESOURCE });
});

/** Claude's token request with an ID-JAG, as it posts it to /token. */
function anIdJagGrant(overrides: Record<string, string | undefined> = {}) {
  return { grant_type: JWT_BEARER, assertion: 'id-jag-charlotte', client_id: 'client-claude', client_secret: 'claude-secret', resource: RESOURCE, ...overrides };
}

describe('a registered client posts an ID-JAG (JWT bearer grant)', () => {
  it('gets an access token acting as the account in its fleet, for an hour, and no refresh token', async () => {
    const answer = await exchangeToken(anIdJagGrant());

    expect(answer).toEqual({ isOk: true, value: { accessToken: 'secret-2', refreshToken: null, expiresInSeconds: 3600, scope: null } });
    expect(pagasae.handedOver).toEqual([{ idJag: 'id-jag-charlotte', clientId: 'client-claude' }]);
    expect(grants.held).toMatchObject([{ grantId: 'secret-1', fleetId: FLEET_ID, accountId: 'acc-charlotte', refreshToken: 'pagasae-refresh-1', accountToken: 'account-token-1' }]);
    await expect(authenticate('secret-2')).resolves.toMatchObject({ isOk: true, value: { fleetId: FLEET_ID, clientId: 'client-claude', holder: { kind: 'account', grantId: 'secret-1' } } });
    expect(tokens.held).toMatchObject([{ refreshHash: null, refreshExpiresAt: null, accessExpiresAt: new Date('2026-10-23T10:00:00.000Z') }]);
  });

  it('works for a public client registered for the code flow, which has no secret', async () => {
    await expect(exchangeToken(anIdJagGrant({ client_id: 'client-public', client_secret: undefined }))).resolves.toMatchObject({ isOk: true });
  });

  it.each([
    { what: 'an unregistered client, as one known only by its metadata document', overrides: { client_id: 'https://claude.ai/oauth/client.json', client_secret: undefined }, error: 'invalid_client' },
    { what: 'a wrong secret', overrides: { client_secret: 'wrong' }, error: 'invalid_client' },
    { what: 'a client that signs in by client credentials, as a party', overrides: { client_id: 'client-machine', client_secret: 'machine-secret' }, error: 'unauthorized_client' },
    { what: 'no ID-JAG', overrides: { assertion: undefined }, error: 'invalid_request' },
    { what: 'another resource', overrides: { resource: 'https://other.example.com/mcp' }, error: 'invalid_target' },
    { what: 'an ID-JAG pagasae refuses', overrides: { assertion: 'id-jag-forged' }, error: 'invalid_grant' },
    { what: 'an account whose one fleet is not the client’s', overrides: { assertion: 'id-jag-elsewhere' }, error: 'invalid_grant' },
  ])('refuses $what, and issues nothing', async ({ overrides, error }) => {
    await expect(exchangeToken(anIdJagGrant(overrides))).resolves.toMatchObject({ isOk: false, error: { error } });
    expect(tokens.held).toEqual([]);
    expect(grants.held).toEqual([]);
  });

  it('refuses a fleet the gateway does not serve', async () => {
    servedFleets.delete(FLEET_ID);

    await expect(exchangeToken(anIdJagGrant())).resolves.toMatchObject({ isOk: false, error: { error: 'invalid_grant' } });
    expect(tokens.held).toEqual([]);
  });

  it('says to sign in at the gateway’s address when pagasae refuses, as for an account in several fleets', async () => {
    await expect(exchangeToken(anIdJagGrant({ assertion: 'id-jag-forged' }))).resolves.toMatchObject({
      isOk: false,
      error: { error: 'invalid_grant', description: expect.stringContaining('one fleet') as unknown },
    });
  });

  it('answers temporarily unavailable while pagasae does not answer', async () => {
    await expect(exchangeToken(anIdJagGrant({ assertion: 'id-jag-down' }))).resolves.toMatchObject({ isOk: false, error: { error: 'temporarily_unavailable' } });
  });
});
