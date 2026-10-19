import { beforeEach, describe, expect, it } from 'vitest';

import { GOOGLE_ISSUER } from '../../../test/support/federation-fakes.js';
import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeClientMetadataDocuments, fakeFleetEndpoints, fakeSecrets, ISSUER, memoryAuthorizationCodes, memoryOAuthClients, OTHER_RESOURCE, RESOURCE } from '../../../test/support/oauth-fakes.js';
import { CHARLOTTE_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import { createReadAuthorization } from '../oauth/read-authorization.js';
import type { PersonParty } from '../parties/party.js';
import { createAuthorizePerson } from './authorize-person.js';

// A person who signed in at the fleet's identity provider is sent back to
// their MCP client with a code for their own ship (interop I-4, Q26 (a)).

const AT = new Date('2026-10-19T09:00:00.000Z');
const CIMD_CLIENT = 'https://claude.example.com/oauth/client.json';
const CALLBACK = 'https://claude.example.com/callback';

/** The request Claude sent to /authorize, kept with the sign-in. */
const REQUEST = { response_type: 'code', client_id: CIMD_CLIENT, redirect_uri: CALLBACK, code_challenge: 'S256(client-verifier)', code_challenge_method: 'S256', resource: RESOURCE, state: 'client-state' };

/** Who Google vouched for. */
const SIGNED_IN = { issuer: GOOGLE_ISSUER, subject: '1078', email: 'charlotte@example.com' };

/** Charlotte as argo mapped her: by her email, not signed in yet. */
function charlotte(overrides: Partial<PersonParty> = {}): PersonParty {
  return {
    fleetId: FLEET_ID,
    name: 'charlotte',
    kind: 'person',
    email: 'charlotte@example.com',
    issuer: null,
    subject: null,
    ownerShipId: CHARLOTTE_SHIP_ID,
    state: 'crewed',
    proxyShipId: CHARLOTTE_SHIP_ID,
    secret: null,
    crewToken: 'aeolus_ct_v1_charlotte',
    requestId: CHARLOTTE_SHIP_ID,
    requestHash: '',
    approvedAt: AT,
    ...overrides,
  };
}

let parties: ReturnType<typeof memoryPartyStore>;
let codes: ReturnType<typeof memoryAuthorizationCodes>;
let authorizePerson: ReturnType<typeof createAuthorizePerson>;

beforeEach(() => {
  const documents = fakeClientMetadataDocuments({ [CIMD_CLIENT]: { client_id: CIMD_CLIENT, client_name: 'Claude', redirect_uris: [CALLBACK] } });
  const readAuthorization = createReadAuthorization({ clients: memoryOAuthClients(), documents, endpoints: fakeFleetEndpoints() });
  parties = memoryPartyStore();
  codes = memoryAuthorizationCodes();
  authorizePerson = createAuthorizePerson({ readAuthorization, parties, codes, secrets: fakeSecrets(), clock: { now: () => AT }, issuer: ISSUER });
});

describe('a person who signed in is sent back to their MCP client as their own ship', () => {
  it('binds the person argo mapped by the verified email to the sign-in, at their first sign-in', async () => {
    await parties.save(charlotte());

    await authorizePerson({ fleetId: FLEET_ID, person: SIGNED_IN, request: REQUEST });

    expect(parties.held.get(`${FLEET_ID}/charlotte`)).toEqual(charlotte({ issuer: GOOGLE_ISSUER, subject: '1078' }));
  });

  it('sends them back with a code for their ship, bound as an approval binds it, and the issuer (RFC 9207)', async () => {
    await parties.save(charlotte());

    const authorized = await authorizePerson({ fleetId: FLEET_ID, person: SIGNED_IN, request: REQUEST });

    expect(authorized).toEqual({ isOk: true, value: { redirectTo: `${CALLBACK}?code=secret-1&state=client-state&iss=${encodeURIComponent(ISSUER)}` } });
    expect([...codes.held.values()]).toEqual([
      { codeHash: 'hash(secret-1)', fleetId: FLEET_ID, clientId: CIMD_CLIENT, redirectUri: CALLBACK, codeChallenge: 'S256(client-verifier)', resource: RESOURCE, scope: null, party: 'charlotte', expiresAt: new Date('2026-10-19T09:01:00.000Z'), isUsed: false },
    ]);
  });

  it('matches an email in another case', async () => {
    await parties.save(charlotte());

    await expect(authorizePerson({ fleetId: FLEET_ID, person: { ...SIGNED_IN, email: 'Charlotte@Example.com' }, request: REQUEST })).resolves.toMatchObject({ isOk: true });
  });

  it('knows a bound person by the subject alone, whatever email the provider says now', async () => {
    await parties.save(charlotte({ issuer: GOOGLE_ISSUER, subject: '1078' }));

    await expect(authorizePerson({ fleetId: FLEET_ID, person: { ...SIGNED_IN, email: 'charlotte@new.example.com' }, request: REQUEST })).resolves.toMatchObject({ isOk: true });
    await expect(authorizePerson({ fleetId: FLEET_ID, person: { ...SIGNED_IN, email: null }, request: REQUEST })).resolves.toMatchObject({ isOk: true });
  });

  it.each([
    { what: 'an email argo did not map', person: { ...SIGNED_IN, email: 'dirk@example.com' }, mapped: charlotte() },
    { what: 'no verified email', person: { ...SIGNED_IN, email: null }, mapped: charlotte() },
    { what: "the email of a person bound to another subject", person: { ...SIGNED_IN, subject: '2091' }, mapped: charlotte({ issuer: GOOGLE_ISSUER, subject: '1078' }) },
    { what: "the email of a person bound at another identity provider", person: SIGNED_IN, mapped: charlotte({ issuer: 'https://login.microsoftonline.com/tenant/v2.0', subject: '1078' }) },
    { what: "an email argo mapped in another fleet", person: SIGNED_IN, mapped: charlotte({ fleetId: OTHER_FLEET_ID }) },
  ])('refuses $what, issuing no code and binding nothing', async ({ person, mapped }) => {
    await parties.save(mapped);

    const authorized = await authorizePerson({ fleetId: FLEET_ID, person, request: REQUEST });

    expect(authorized).toMatchObject({ isOk: false, error: { kind: 'notMapped' } });
    expect(authorized.isOk ? '' : 'message' in authorized.error ? authorized.error.message : '').not.toBe('');
    expect(codes.held.size).toBe(0);
    expect([...parties.held.values()]).toEqual([mapped]);
  });

  it("refuses a request for another fleet's MCP endpoint than the sign-in's", async () => {
    await parties.save(charlotte());

    await expect(authorizePerson({ fleetId: FLEET_ID, person: SIGNED_IN, request: { ...REQUEST, resource: OTHER_RESOURCE } })).resolves.toMatchObject({ isOk: false, error: { kind: 'invalidClient' } });
    expect(codes.held.size).toBe(0);
  });

  it('refuses a request /authorize refuses now, as it does', async () => {
    await parties.save(charlotte());

    await expect(authorizePerson({ fleetId: FLEET_ID, person: SIGNED_IN, request: { ...REQUEST, code_challenge_method: 'plain' } })).resolves.toMatchObject({ isOk: false, error: { kind: 'redirect', error: 'invalid_request' } });
    expect(codes.held.size).toBe(0);
  });
});
