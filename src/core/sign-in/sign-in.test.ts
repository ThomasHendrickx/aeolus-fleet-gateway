import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeClientMetadataDocuments, fakeSecrets, ISSUER, memoryAuthorizationCodes, memoryOAuthClients, RESOURCE } from '../../../test/support/oauth-fakes.js';
import { CHARLOTTE_TOKENS, fakePagasae, memoryAccountGrants, fakeSignInSeals, PAGASAE_URL, PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { createReadAuthorization } from '../oauth/read-authorization.js';
import type { Pagasae } from './ports.js';
import { createCompleteSignIn } from './complete-sign-in.js';
import { createStartSignIn } from './start-sign-in.js';

// A person signs in to the gateway through pagasae (decision 0054): the
// gateway keeps the client's request, sends the person to pagasae, which
// answers the account and picks the fleet, and sends the client back with
// the gateway's own code for that account's grant.

const STARTED_AT = new Date('2026-10-19T09:00:00.000Z');
const CIMD_CLIENT = 'https://claude.example.com/oauth/client.json';
const CALLBACK = 'https://claude.example.com/callback';

let now: Date;
let secrets: ReturnType<typeof fakeSecrets>;
let clients: ReturnType<typeof memoryOAuthClients>;
let seals: ReturnType<typeof fakeSignInSeals>;
let grants: ReturnType<typeof memoryAccountGrants>;
let codes: ReturnType<typeof memoryAuthorizationCodes>;
let served: FleetId[];

beforeEach(async () => {
  now = STARTED_AT;
  secrets = fakeSecrets();
  clients = memoryOAuthClients();
  await clients.save({ clientId: 'client-cursor', fleetId: OTHER_FLEET_ID, name: 'Cursor', redirectUris: ['https://cursor.example.com/callback'], secretHash: null });
  seals = fakeSignInSeals();
  grants = memoryAccountGrants();
  codes = memoryAuthorizationCodes();
  served = [FLEET_ID];
});

function readAuthorization() {
  return createReadAuthorization({
    clients,
    documents: fakeClientMetadataDocuments({ [CIMD_CLIENT]: { client_id: CIMD_CLIENT, client_name: 'Claude', redirect_uris: [CALLBACK] } }),
    resource: RESOURCE,
  });
}

function startSignIn() {
  return createStartSignIn({ readAuthorization: readAuthorization(), seals, pagasae: fakePagasae({ refusal: 'unused' }), secrets, clock: { now: () => now } });
}

/** pagasae redeems its code pagasae-code-1 for the verifier the start drew, secret-1. */
function completeSignIn(pagasae: Pagasae = fakePagasae({ code: 'pagasae-code-1', verifier: 'secret-1', tokens: CHARLOTTE_TOKENS })) {
  return createCompleteSignIn({
    readAuthorization: readAuthorization(),
    seals,
    pagasae,
    grants,
    codes,
    secrets,
    clock: { now: () => now },
    issuer: ISSUER,
    servesFleet: (fleetId) => Promise.resolve(served.includes(fleetId)),
  });
}

/** An authorization request as a client sends it to /authorize. */
function aRequest(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { response_type: 'code', client_id: CIMD_CLIENT, redirect_uri: CALLBACK, code_challenge: 'S256(verifier-1)', code_challenge_method: 'S256', resource: RESOURCE, state: 'state-1', scope: undefined, ...overrides };
}

/** The person started at /authorize; pagasae sends them back with this, to the browser holding the secret the start drew after the verifier. */
async function started(request = aRequest()) {
  await startSignIn()(request);
  return { state: 'sealed-1', code: 'pagasae-code-1', browserSecret: 'secret-2' };
}

describe('a person starts signing in at /authorize', () => {
  it("is sent to pagasae with the gateway's own PKCE challenge and the sign-in sealed in the state, naming no fleet, so pagasae picks it", async () => {
    await expect(startSignIn()(aRequest())).resolves.toMatchObject({ isOk: true, value: { redirectTo: `${PAGASAE_URL}/oauth/authorize?state=sealed-1&code_challenge=S256(secret-1)` } });
  });

  it('answers a new secret for the browser to hold, so only that browser finishes the sign-in', async () => {
    await expect(startSignIn()(aRequest())).resolves.toMatchObject({ isOk: true, value: { browserSecret: 'secret-2' } });
  });

  it("seals the client's request for 10 minutes with the verifier and the browser's secret, storing nothing", async () => {
    await startSignIn()(aRequest());

    expect([...seals.held.values()]).toEqual([{ verifier: 'secret-1', browserSecret: 'secret-2', request: aRequest(), expiresAt: new Date('2026-10-19T09:10:00.000Z') }]);
  });

  it('is refused as /authorize refuses a request, keeping nothing', async () => {
    await expect(startSignIn()(aRequest({ redirect_uri: 'https://evil.example.com/callback' }))).resolves.toMatchObject({ isOk: false, error: { kind: 'invalidClient' } });
    await expect(startSignIn()(aRequest({ code_challenge_method: 'plain' }))).resolves.toMatchObject({ isOk: false, error: { kind: 'redirect', error: 'invalid_request' } });
    expect(seals.held.size).toBe(0);
  });
});

describe('pagasae sends the person back', () => {
  it("sends the client back with the gateway's code for the account's grant, with its state and the issuer", async () => {
    const back = await started();

    await expect(completeSignIn()(back)).resolves.toEqual({ isOk: true, value: { redirectTo: `${CALLBACK}?code=secret-4&state=state-1&iss=${encodeURIComponent(ISSUER)}` } });
  });

  it("keeps the account's grant: its fleet, account and person ship, pagasae's refresh token and the account token", async () => {
    await completeSignIn()(await started());

    expect(grants.held).toEqual([
      {
        grantId: 'secret-3',
        fleetId: FLEET_ID,
        accountId: 'acc-charlotte',
        personShipId: PERSON_SHIP_ID,
        refreshToken: 'pagasae-refresh-1',
        accountToken: 'account-token-1',
        accountTokenExpiresAt: new Date('2026-10-19T09:10:00.000Z'),
      },
    ]);
  });

  it("binds the code to the client's request and the grant, for one minute", async () => {
    await completeSignIn()(await started());

    expect([...codes.held.values()]).toEqual([
      {
        codeHash: 'hash(secret-4)',
        fleetId: FLEET_ID,
        clientId: CIMD_CLIENT,
        redirectUri: CALLBACK,
        codeChallenge: 'S256(verifier-1)',
        resource: RESOURCE,
        scope: null,
        kind: 'account',
        grantId: 'secret-3',
        expiresAt: new Date('2026-10-19T09:01:00.000Z'),
        isUsed: false,
      },
    ]);
  });

  it('refuses a sign-in 10 minutes after it started, and takes one just before', async () => {
    const back = await started();
    now = new Date('2026-10-19T09:10:00.000Z');
    await expect(completeSignIn()(back)).resolves.toEqual({ isOk: false, error: { kind: 'unknownSignIn' } });

    now = new Date('2026-10-19T09:09:59.999Z');
    await expect(completeSignIn()(back)).resolves.toMatchObject({ isOk: true });
  });

  it.each([
    ['no state', { state: undefined, code: 'pagasae-code-1', browserSecret: 'secret-2' }],
    ['a state the gateway never gave', { state: 'forged', code: 'pagasae-code-1', browserSecret: 'secret-2' }],
  ])('refuses %s', async (_what, back) => {
    await started();

    await expect(completeSignIn()(back)).resolves.toEqual({ isOk: false, error: { kind: 'unknownSignIn' } });
  });

  it.each([
    ['holds no secret', undefined],
    ["holds another sign-in's secret", 'secret-9'],
  ])('refuses a browser that %s, as when another site makes it finish its own sign-in, redeeming nothing', async (_what, browserSecret) => {
    const back = await started();
    const redeemed: string[] = [];
    const pagasae = fakePagasae({ code: 'pagasae-code-1', verifier: 'secret-1', tokens: CHARLOTTE_TOKENS });
    const watched: Pagasae = { ...pagasae, redeemCode: (code) => { redeemed.push(code.code); return pagasae.redeemCode(code); } };

    await expect(completeSignIn(watched)({ ...back, browserSecret })).resolves.toEqual({ isOk: false, error: { kind: 'otherBrowser' } });
    expect({ redeemed, grants: grants.held.length, codes: codes.held.size }).toEqual({ redeemed: [], grants: 0, codes: 0 });
  });

  it("sends the client back with access_denied when pagasae answers an error, keeping no grant", async () => {
    const { state, browserSecret } = await started();

    await expect(completeSignIn()({ state, browserSecret, error: 'access_denied' })).resolves.toEqual({ isOk: true, value: { redirectTo: `${CALLBACK}?error=access_denied&state=state-1&iss=${encodeURIComponent(ISSUER)}` } });
    expect(grants.held).toEqual([]);
  });

  it('says why when pagasae refuses its code, issuing no code', async () => {
    const back = await started();

    await expect(completeSignIn(fakePagasae({ refusal: 'invalid_grant' }))(back)).resolves.toEqual({ isOk: false, error: { kind: 'pagasaeRefused', message: 'invalid_grant' } });
    expect(codes.held.size).toBe(0);
  });

  it('refuses a fleet this gateway does not serve, keeping no grant and issuing no code', async () => {
    served = [];
    const back = await started();

    await expect(completeSignIn()(back)).resolves.toEqual({ isOk: false, error: { kind: 'fleetNotServed' } });
    expect({ grants: grants.held.length, codes: codes.held.size }).toEqual({ grants: 0, codes: 0 });
  });

  it("refuses a client pre-registered for another fleet than the account's", async () => {
    const back = await started(aRequest({ client_id: 'client-cursor', redirect_uri: 'https://cursor.example.com/callback' }));

    await expect(completeSignIn()(back)).resolves.toMatchObject({ isOk: false, error: { kind: 'invalidClient' } });
    expect(codes.held.size).toBe(0);
  });
});
