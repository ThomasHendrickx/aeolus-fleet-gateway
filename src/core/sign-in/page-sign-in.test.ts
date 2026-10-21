import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeClientMetadataDocuments, fakeSecrets, ISSUER, memoryAuthorizationCodes, memoryOAuthClients, RESOURCE } from '../../../test/support/oauth-fakes.js';
import { CHARLOTTE_TOKENS, fakePagasae, fakePageSessions, fakeSignInSeals, memoryAccountGrants, PAGASAE_URL, PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { createReadAuthorization } from '../oauth/read-authorization.js';
import { err } from '../shared/result.js';
import type { Pagasae } from './ports.js';
import { createCompleteSignIn } from './complete-sign-in.js';
import { createSignOut } from './sign-out.js';
import { createStartPageSignIn } from './start-page-sign-in.js';

// A person signs in to the gateway's own pages through pagasae, as an MCP
// client's person does (decision 0054): the gateway keeps the account's
// grant, and the browser holds a page session naming it, so the pages act in
// the fleet as the account, with the scopes its account token carries.

const STARTED_AT = new Date('2026-10-19T09:00:00.000Z');

let now: Date;
let secrets: ReturnType<typeof fakeSecrets>;
let seals: ReturnType<typeof fakeSignInSeals>;
let grants: ReturnType<typeof memoryAccountGrants>;
let sessions: ReturnType<typeof fakePageSessions>;
let served: FleetId[];

beforeEach(() => {
  now = STARTED_AT;
  secrets = fakeSecrets();
  seals = fakeSignInSeals();
  grants = memoryAccountGrants();
  sessions = fakePageSessions();
  served = [FLEET_ID];
});

function startPageSignIn() {
  return createStartPageSignIn({ seals, pagasae: fakePagasae({ refusal: 'unused' }), secrets, clock: { now: () => now }, origin: ISSUER });
}

/** pagasae redeems its code pagasae-code-1 for the verifier the start drew, secret-1. */
function completeSignIn(pagasae: Pagasae = fakePagasae({ code: 'pagasae-code-1', verifier: 'secret-1', tokens: CHARLOTTE_TOKENS })) {
  return createCompleteSignIn({
    readAuthorization: createReadAuthorization({ clients: memoryOAuthClients(), documents: fakeClientMetadataDocuments(), resource: RESOURCE }),
    seals,
    pagasae,
    grants,
    codes: memoryAuthorizationCodes(),
    secrets,
    clock: { now: () => now },
    issuer: ISSUER,
    servesFleet: (fleetId) => Promise.resolve(served.includes(fleetId)),
    askForClient: () => Promise.resolve(err({ kind: 'OUTSIDE_PARTIES_OFF', message: 'unused' })),
    sessions,
  });
}

/** The person started signing in to the pages; pagasae sends them back with this, to the browser holding the secret the start drew. */
function started(returnTo?: string) {
  startPageSignIn()({ returnTo });
  return { state: 'sealed-1', code: 'pagasae-code-1', browserSecret: 'secret-2' };
}

describe('a person starts signing in to the pages', () => {
  it("is sent to pagasae with the gateway's own PKCE challenge, naming no fleet, and holds a new secret", () => {
    expect(startPageSignIn()({ returnTo: '/overview' })).toEqual({ redirectTo: `${PAGASAE_URL}/oauth/authorize?state=sealed-1&code_challenge=S256(secret-1)`, browserSecret: 'secret-2' });
  });

  it.each([
    { what: 'a page with its query and hash', returnTo: '/overview/requests/req_1?tab=scopes#owner', sealed: '/overview/requests/req_1?tab=scopes#owner' },
    { what: "a page by the gateway's own address", returnTo: `${ISSUER}/overview?tab=ships`, sealed: '/overview?tab=ships' },
    { what: 'a page with dot segments', returnTo: '/overview/../requests', sealed: '/requests' },
  ])('goes back to $what, on the gateway itself', ({ returnTo, sealed }) => {
    startPageSignIn()({ returnTo });

    expect([...seals.held.values()]).toMatchObject([{ returnTo: sealed }]);
  });

  it('seals the page to go back to for 10 minutes, with the verifier and the browser secret, storing nothing', () => {
    startPageSignIn()({ returnTo: '/overview/requests/req_1?tab=scopes' });

    expect([...seals.held.values()]).toEqual([{ holder: 'page', returnTo: '/overview/requests/req_1?tab=scopes', verifier: 'secret-1', browserSecret: 'secret-2', expiresAt: new Date('2026-10-19T09:10:00.000Z') }]);
    expect(grants.held).toEqual([]);
  });

  it.each([
    { what: 'no page', returnTo: undefined },
    { what: 'another site', returnTo: 'https://evil.example.com/overview' },
    { what: 'another site without a scheme', returnTo: '//evil.example.com/overview' },
    { what: 'another site behind a backslash', returnTo: '/\\evil.example.com' },
    { what: 'another site behind a tab', returnTo: '/\t/evil.example' },
    { what: 'another site behind a newline', returnTo: '/\n/evil.example' },
    { what: 'another site behind a carriage return', returnTo: '/\r/evil.example' },
    { what: 'another site behind a tab and a backslash', returnTo: '/\t\\evil.example' },
    { what: 'another site behind two backslashes', returnTo: '\\\\evil.example' },
    { what: 'another site behind a backslash and a slash', returnTo: '\\/evil.example' },
  ])('goes back to the overview for $what, never to another site', ({ returnTo }) => {
    startPageSignIn()({ returnTo });

    expect([...seals.held.values()]).toMatchObject([{ returnTo: '/overview' }]);
  });
});

describe('pagasae sends the person back to the pages', () => {
  it('opens a page session for the account and sends the browser to the page it asked for', async () => {
    await expect(completeSignIn()(started('/parties'))).resolves.toEqual({ isOk: true, value: { kind: 'signedIn', session: 'session-1', redirectTo: '/parties' } });
  });

  it("keeps the account's grant with the scopes its account token carries, the session naming it", async () => {
    await completeSignIn()(started());

    expect({ grants: grants.held, sessions: [...sessions.held.values()] }).toEqual({
      grants: [
        {
          grantId: 'secret-3',
          fleetId: FLEET_ID,
          accountId: 'acc-charlotte',
          personShipId: PERSON_SHIP_ID,
          scopes: ['fleet:read', 'gateway:approve'],
          refreshToken: 'pagasae-refresh-1',
          accountToken: 'account-token-1',
          accountTokenExpiresAt: new Date('2026-10-19T09:10:00.000Z'),
        },
      ],
      sessions: [{ fleetId: FLEET_ID, grantId: 'secret-3' }],
    });
  });

  it('refuses a fleet this gateway does not serve, keeping no grant and opening no session', async () => {
    served = [];

    await expect(completeSignIn()(started())).resolves.toEqual({ isOk: false, error: { kind: 'fleetNotServed' } });
    expect({ grants: grants.held, sessions: sessions.held.size }).toEqual({ grants: [], sessions: 0 });
  });

  it('says why when pagasae answers an error, opening no session', async () => {
    await expect(completeSignIn()({ ...started(), code: undefined, error: 'access_denied' })).resolves.toEqual({ isOk: false, error: { kind: 'pagasaeRefused', message: 'access_denied' } });
    expect(sessions.held.size).toBe(0);
  });

  it('refuses another browser than the one that started, opening no session', async () => {
    await expect(completeSignIn()({ ...started(), browserSecret: 'secret-9' })).resolves.toEqual({ isOk: false, error: { kind: 'otherBrowser' } });
    expect(sessions.held.size).toBe(0);
  });
});

describe('a person signs out of the pages', () => {
  it("ends the session's grant, keeping the account's other sign-ins", async () => {
    await completeSignIn()(started());
    await grants.save({ ...CHARLOTTE_TOKENS, grantId: 'grant-of-a-client' });

    await createSignOut({ grants })({ fleetId: FLEET_ID, grantId: 'secret-3' });

    expect(grants.held.map(({ grantId }) => grantId)).toEqual(['grant-of-a-client']);
  });
});
