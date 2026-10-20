import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { plainHasher } from '../../../test/support/memory-installation.js';
import { OWNER_SHIP_ID, PROXY_SHIP_ID, fakeProxyShipFleet, memoryPartyStore } from '../../../test/support/party-fakes.js';
import { createApproveClientParty } from '../parties/approve-party.js';
import { fakeClientMetadataDocuments, fakeSecrets, ISSUER, memoryAuthorizationCodes, memoryOAuthClients, RESOURCE } from '../../../test/support/oauth-fakes.js';
import { createApproveAuthorization } from './approve-authorization.js';
import { createReadAuthorization } from './read-authorization.js';

const AT = new Date('2026-10-19T09:00:00.000Z');
const CIMD_CLIENT = 'https://claude.example.com/oauth/client.json';
const CALLBACK = 'https://claude.example.com/callback';

let clients: ReturnType<typeof memoryOAuthClients>;
let documents: ReturnType<typeof fakeClientMetadataDocuments>;
let codes: ReturnType<typeof memoryAuthorizationCodes>;
let readAuthorization: ReturnType<typeof createReadAuthorization>;
let approveAuthorization: ReturnType<typeof createApproveAuthorization>;
let fleet: ReturnType<typeof fakeProxyShipFleet>;
let parties: ReturnType<typeof memoryPartyStore>;

/** The party argo names for a client at its first approval. */
const NEW_PARTY = { requestId: 'r-1', name: 'claude', ownerShipId: OWNER_SHIP_ID };

beforeEach(async () => {
  clients = memoryOAuthClients();
  await clients.save({ clientId: 'client-cursor', fleetId: FLEET_ID, name: 'Cursor', redirectUris: ['https://cursor.example.com/callback'], secretHash: 'hash(cursor-secret)' });
  documents = fakeClientMetadataDocuments({
    [CIMD_CLIENT]: { client_id: CIMD_CLIENT, client_name: 'Claude', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none' },
  });
  codes = memoryAuthorizationCodes();
  readAuthorization = createReadAuthorization({ clients, documents, resource: RESOURCE });
  fleet = fakeProxyShipFleet();
  parties = memoryPartyStore();
  const connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: AT });
  approving(createApproveClientParty({ connections, parties, door: fleet.door, hasher: plainHasher, clock: { now: () => AT } }));
});

function approving(approveClientParty: ReturnType<typeof createApproveClientParty>) {
  approveAuthorization = createApproveAuthorization({ readAuthorization, codes, secrets: fakeSecrets(), clock: { now: () => AT }, issuer: ISSUER, parties, approveClientParty });
}

/** An authorization request as a client sends it to /authorize. */
function aRequest(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    response_type: 'code',
    client_id: CIMD_CLIENT,
    redirect_uri: CALLBACK,
    code_challenge: 'S256(verifier-1)',
    code_challenge_method: 'S256',
    resource: RESOURCE,
    state: 'state-1',
    scope: undefined,
    ...overrides,
  };
}

describe('the gateway reads an authorization request (OAuth 2.1, MCP 2026-07-28)', () => {
  it('reads a client from its metadata document (CIMD), for argo to approve', async () => {
    await expect(readAuthorization(aRequest())).resolves.toEqual({
      isOk: true,
      value: { clientId: CIMD_CLIENT, clientName: 'Claude', clientFleetId: null, redirectUri: CALLBACK, codeChallenge: 'S256(verifier-1)', resource: RESOURCE, scope: null, state: 'state-1' },
    });
  });

  it('reads a pre-registered client, with its fleet', async () => {
    await expect(readAuthorization(aRequest({ client_id: 'client-cursor', redirect_uri: 'https://cursor.example.com/callback' }))).resolves.toMatchObject({
      isOk: true,
      value: { clientName: 'Cursor', clientFleetId: FLEET_ID },
    });
  });

  it.each([
    ['an unknown client', { client_id: 'client-unknown' }],
    ['a metadata document that does not answer', { client_id: 'https://gone.example.com/client.json' }],
    ['a redirect URI the client did not register', { redirect_uri: 'https://evil.example.com/callback' }],
    ['no redirect URI', { redirect_uri: undefined }],
  ])('refuses %s on the page, redirecting nowhere', async (_what, overrides) => {
    await expect(readAuthorization(aRequest(overrides))).resolves.toMatchObject({ isOk: false, error: { kind: 'invalidClient' } });
  });

  it('refuses a metadata document naming another client id', async () => {
    documents = fakeClientMetadataDocuments({ [CIMD_CLIENT]: { client_id: 'https://other.example.com/client.json', redirect_uris: [CALLBACK] } });
    readAuthorization = createReadAuthorization({ clients, documents, resource: RESOURCE });

    await expect(readAuthorization(aRequest())).resolves.toMatchObject({ isOk: false, error: { kind: 'invalidClient' } });
  });

  it.each([
    { what: 'another response type', overrides: { response_type: 'token' }, error: 'unsupported_response_type' },
    { what: 'no code challenge', overrides: { code_challenge: undefined }, error: 'invalid_request' },
    { what: 'the plain challenge method', overrides: { code_challenge_method: 'plain' }, error: 'invalid_request' },
    { what: 'no resource', overrides: { resource: undefined }, error: 'invalid_target' },
    { what: 'another resource', overrides: { resource: 'https://other.example.com/mcp' }, error: 'invalid_target' },
  ])('sends the client back with an error for $what', async ({ overrides, error }) => {
    await expect(readAuthorization(aRequest(overrides))).resolves.toMatchObject({ isOk: false, error: { kind: 'redirect', redirectUri: CALLBACK, error, state: 'state-1' } });
  });
});

describe('argo approves an authorization request', () => {
  it('issues a code bound to the client, its redirect URI, its challenge and the resource, and sends the client back with it', async () => {
    await expect(approveAuthorization({ fleetId: FLEET_ID, request: aRequest(), isApproved: true, newParty: NEW_PARTY })).resolves.toEqual({
      isOk: true,
      value: { redirectTo: `${CALLBACK}?code=secret-1&state=state-1&iss=${encodeURIComponent(ISSUER)}` },
    });
    expect([...codes.held.values()]).toEqual([
      {
        codeHash: 'hash(secret-1)',
        fleetId: FLEET_ID,
        clientId: CIMD_CLIENT,
        redirectUri: CALLBACK,
        codeChallenge: 'S256(verifier-1)',
        resource: RESOURCE,
        scope: null,
        kind: 'party',
        party: 'claude',
        expiresAt: new Date('2026-10-19T09:01:00.000Z'),
        isUsed: false,
      },
    ]);
  });

  it('sends the client back with access_denied when argo denies it, issuing no code', async () => {
    await expect(approveAuthorization({ fleetId: FLEET_ID, request: aRequest(), isApproved: false })).resolves.toEqual({
      isOk: true,
      value: { redirectTo: `${CALLBACK}?error=access_denied&state=state-1&iss=${encodeURIComponent(ISSUER)}` },
    });
    expect(codes.held.size).toBe(0);
  });

  it("refuses a client pre-registered for another fleet than argo's", async () => {
    await expect(approveAuthorization({ fleetId: OTHER_FLEET_ID, request: aRequest({ client_id: 'client-cursor', redirect_uri: 'https://cursor.example.com/callback' }), isApproved: true, newParty: NEW_PARTY })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'invalidClient' },
    });
    expect(codes.held.size).toBe(0);
  });

  it('reads the request again, so a changed request is refused as any is', async () => {
    await expect(approveAuthorization({ fleetId: FLEET_ID, request: aRequest({ redirect_uri: 'https://evil.example.com/callback' }), isApproved: true, newParty: NEW_PARTY })).resolves.toMatchObject({ isOk: false, error: { kind: 'invalidClient' } });
  });

  it('keeps a redirect URI query, adding the code to it', async () => {
    documents = fakeClientMetadataDocuments({ [CIMD_CLIENT]: { client_id: CIMD_CLIENT, redirect_uris: [`${CALLBACK}?tenant=a`] } });
    readAuthorization = createReadAuthorization({ clients, documents, resource: RESOURCE });
    approving(createApproveClientParty({ connections: memoryConnectionStoreWith(), parties, door: fleet.door, hasher: plainHasher, clock: { now: () => AT } }));

    await expect(approveAuthorization({ fleetId: FLEET_ID, request: aRequest({ redirect_uri: `${CALLBACK}?tenant=a`, state: undefined }), isApproved: true, newParty: NEW_PARTY })).resolves.toEqual({
      isOk: true,
      value: { redirectTo: `${CALLBACK}?tenant=a&code=secret-1&iss=${encodeURIComponent(ISSUER)}` },
    });
  });
});

/** A gateway connected to the fleet, for a test that builds its own approval. */
function memoryConnectionStoreWith() {
  const connections = memoryConnectionStore();
  void connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: AT });
  return connections;
}

describe('argo approves a client as a party: the proxy ship it calls the fleet as', () => {
  it("names its party at the client's first approval: the gateway commissions and crews its proxy ship before the code is issued", async () => {
    await approveAuthorization({ fleetId: FLEET_ID, request: aRequest(), isApproved: true, newParty: NEW_PARTY });

    expect({ commissioned: fleet.state.commissioned.map(({ name, type }) => [name, type]), party: (await parties.findByClient(FLEET_ID, CIMD_CLIENT))?.state }).toEqual({ commissioned: [['claude', 'mcp-client']], party: 'crewed' });
  });

  it('approves a client that has a party again with one click: no name, no second ship', async () => {
    await approveAuthorization({ fleetId: FLEET_ID, request: aRequest(), isApproved: true, newParty: NEW_PARTY });

    await expect(approveAuthorization({ fleetId: FLEET_ID, request: aRequest(), isApproved: true })).resolves.toMatchObject({ isOk: true });
    expect([...codes.held.values()].map((code) => code.party)).toEqual(['claude', 'claude']);
    expect(fleet.state.commissioned).toHaveLength(1);
  });

  it('asks argo to name the party of a client that has none, issuing no code', async () => {
    await expect(approveAuthorization({ fleetId: FLEET_ID, request: aRequest(), isApproved: true })).resolves.toMatchObject({ isOk: false, error: { kind: 'needsParty' } });
    expect(codes.held.size).toBe(0);
  });

  it("says why when the party's proxy ship could not be crewed, issuing no code", async () => {
    fleet.state.isAnswering = false;

    const approved = await approveAuthorization({ fleetId: FLEET_ID, request: aRequest(), isApproved: true, newParty: NEW_PARTY });

    expect(!approved.isOk && approved.error.kind === 'partyRefused' && approved.error.message).toMatch(/did not answer/);
    expect(codes.held.size).toBe(0);
  });

  it('refuses a party whose proxy ship awaits crew, until argo hands its secret over', async () => {
    fleet.state.isLosingNextAnswer = true;
    await approveAuthorization({ fleetId: FLEET_ID, request: aRequest(), isApproved: true, newParty: NEW_PARTY });

    await expect(approveAuthorization({ fleetId: FLEET_ID, request: aRequest(), isApproved: true, newParty: NEW_PARTY })).resolves.toMatchObject({ isOk: false, error: { kind: 'partyRefused' } });
    await expect(parties.findByClient(FLEET_ID, CIMD_CLIENT)).resolves.toMatchObject({ state: 'awaitingCrew', proxyShipId: PROXY_SHIP_ID });
  });

  it('commissions nothing when argo denies', async () => {
    await approveAuthorization({ fleetId: FLEET_ID, request: aRequest(), isApproved: false, newParty: NEW_PARTY });

    expect(fleet.state.commissioned).toEqual([]);
  });
});
