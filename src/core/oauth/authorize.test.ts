import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeClientMetadataDocuments, memoryOAuthClients, RESOURCE } from '../../../test/support/oauth-fakes.js';
import { createReadAuthorization } from './read-authorization.js';

const CIMD_CLIENT = 'https://claude.example.com/oauth/client.json';
const CALLBACK = 'https://claude.example.com/callback';
/** A native client: its document lists loopback redirect URIs with no port, as it listens on one the system picks at run time. */
const NATIVE_CLIENT = 'https://codex.example.com/oauth/client.json';

let clients: ReturnType<typeof memoryOAuthClients>;
let documents: ReturnType<typeof fakeClientMetadataDocuments>;
let readAuthorization: ReturnType<typeof createReadAuthorization>;

beforeEach(async () => {
  clients = memoryOAuthClients();
  await clients.save({ clientId: 'client-cursor', fleetId: FLEET_ID, name: 'Cursor', redirectUris: ['https://cursor.example.com/callback'], secretHash: 'hash(cursor-secret)' });
  documents = fakeClientMetadataDocuments({
    [CIMD_CLIENT]: { client_id: CIMD_CLIENT, client_name: 'Claude', redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none' },
    [NATIVE_CLIENT]: { client_id: NATIVE_CLIENT, client_name: 'Codex', redirect_uris: ['http://127.0.0.1/callback', 'http://localhost/callback', 'http://[::1]/callback'], token_endpoint_auth_method: 'none' },
  });
  readAuthorization = createReadAuthorization({ clients, documents, resource: RESOURCE });
});

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
  it('reads a client from its metadata document (CIMD)', async () => {
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
    'http://127.0.0.1:54321/callback',
    'http://localhost:1/callback',
    'http://[::1]:65535/callback',
  ])('takes any port on a loopback redirect URI the client registered without one (RFC 8252, 7.3): %s', async (redirectUri) => {
    await expect(readAuthorization(aRequest({ client_id: NATIVE_CLIENT, redirect_uri: redirectUri }))).resolves.toMatchObject({ isOk: true, value: { clientName: 'Codex', redirectUri } });
  });

  it.each([
    ['another path', 'http://127.0.0.1:54321/other'],
    ['a query', 'http://127.0.0.1:54321/callback?next=1'],
    ['https', 'https://127.0.0.1:54321/callback'],
    ['a host that is not loopback', 'http://127.0.0.2:54321/callback'],
  ])('refuses a loopback redirect URI on any port with %s', async (_what, redirectUri) => {
    await expect(readAuthorization(aRequest({ client_id: NATIVE_CLIENT, redirect_uri: redirectUri }))).resolves.toMatchObject({ isOk: false, error: { kind: 'invalidClient' } });
  });

  it('takes no other port on a redirect URI that is not loopback', async () => {
    await expect(readAuthorization(aRequest({ redirect_uri: 'https://claude.example.com:8443/callback' }))).resolves.toMatchObject({ isOk: false, error: { kind: 'invalidClient' } });
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
