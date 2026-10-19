import { beforeEach, describe, expect, it } from 'vitest';

import { aProviderMetadata, fakeProviderDiscovery, fakeProviderSignIn, GOOGLE_ISSUER, memoryIdentityProviders, memorySignIns } from '../../../test/support/federation-fakes.js';
import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeClientMetadataDocuments, fakeFleetEndpoints, fakeSecrets, ISSUER, memoryOAuthClients, RESOURCE } from '../../../test/support/oauth-fakes.js';
import { createReadAuthorization } from '../oauth/read-authorization.js';
import { createCompleteSignIn } from './complete-sign-in.js';
import { createStartSignIn } from './start-sign-in.js';

// A person signs in to the gateway at the company's identity provider
// (interop I-4, Q25: who comes without argo's console session is a person).

const AT = new Date('2026-10-19T09:00:00.000Z');
const CIMD_CLIENT = 'https://claude.example.com/oauth/client.json';
const CALLBACK = 'https://claude.example.com/callback';
const SIGN_IN_CALLBACK = `${ISSUER}/oidc/callback`;
const CHARLOTTE = { issuer: GOOGLE_ISSUER, subject: '1078', email: 'charlotte@example.com' };

let now: Date;
let providers: ReturnType<typeof memoryIdentityProviders>;
let signIns: ReturnType<typeof memorySignIns>;
let providerSignIn: ReturnType<typeof fakeProviderSignIn>;
let startSignIn: ReturnType<typeof createStartSignIn>;
let completeSignIn: ReturnType<typeof createCompleteSignIn>;

/** The authorization request Claude sends to /authorize for the fleet's MCP endpoint. */
const REQUEST = { response_type: 'code', client_id: CIMD_CLIENT, redirect_uri: CALLBACK, code_challenge: 'S256(client-verifier)', code_challenge_method: 'S256', resource: RESOURCE, state: 'client-state' };

beforeEach(async () => {
  now = AT;
  const clock = { now: () => now };
  const documents = fakeClientMetadataDocuments({ [CIMD_CLIENT]: { client_id: CIMD_CLIENT, client_name: 'Claude', redirect_uris: [CALLBACK] } });
  const readAuthorization = createReadAuthorization({ clients: memoryOAuthClients(), documents, endpoints: fakeFleetEndpoints() });
  providers = memoryIdentityProviders();
  await providers.save({ fleetId: FLEET_ID, issuer: GOOGLE_ISSUER, clientId: 'gateway.apps.googleusercontent.com', clientSecret: 'google-secret', setAt: AT });
  const discovery = fakeProviderDiscovery({ [GOOGLE_ISSUER]: aProviderMetadata(GOOGLE_ISSUER) });
  signIns = memorySignIns();
  providerSignIn = fakeProviderSignIn({ 'google-code': CHARLOTTE });
  const secrets = fakeSecrets();
  startSignIn = createStartSignIn({ readAuthorization, providers, discovery, signIns, secrets, clock, callbackUrl: SIGN_IN_CALLBACK });
  completeSignIn = createCompleteSignIn({ signIns, providers, discovery, providerSignIn, secrets, clock, callbackUrl: SIGN_IN_CALLBACK });
});

describe('a person starts signing in at the fleet of the MCP endpoint their client asks for', () => {
  it("sends them to the fleet's identity provider: the code flow with PKCE, a state and a nonce, back to the gateway", async () => {
    const started = await startSignIn(REQUEST);

    expect(started).toEqual({
      isOk: true,
      value: {
        redirectTo: `${GOOGLE_ISSUER}/o/oauth2/v2/auth?${new URLSearchParams({
          response_type: 'code',
          client_id: 'gateway.apps.googleusercontent.com',
          redirect_uri: SIGN_IN_CALLBACK,
          scope: 'openid email',
          state: 'secret-1',
          nonce: 'secret-2',
          code_challenge: 'S256(secret-3)',
          code_challenge_method: 'S256',
        }).toString()}`,
      },
    });
  });

  it("keeps the sign-in by its state's hash for 10 minutes, with the client's request to go on with", async () => {
    await startSignIn(REQUEST);

    expect([...signIns.held.values()]).toEqual([{ stateHash: 'hash(secret-1)', fleetId: FLEET_ID, request: REQUEST, verifier: 'secret-3', nonce: 'secret-2', expiresAt: new Date('2026-10-19T09:10:00.000Z') }]);
  });

  it("refuses the client's request as /authorize does, starting nothing", async () => {
    await expect(startSignIn({ ...REQUEST, code_challenge_method: 'plain' })).resolves.toMatchObject({ isOk: false, error: { kind: 'redirect', error: 'invalid_request' } });
    expect(signIns.held.size).toBe(0);
  });

  it('refuses a fleet with no identity provider: people cannot sign in yet', async () => {
    providers.held.clear();

    await expect(startSignIn(REQUEST)).resolves.toMatchObject({ isOk: false, error: { kind: 'noIdentityProvider' } });
  });
});

describe('a person comes back from the identity provider', () => {
  async function started(): Promise<void> {
    await startSignIn(REQUEST);
  }

  it('is signed in as the person the provider vouches for, checked against the sign-in, with the request to go on with', async () => {
    await started();

    const completed = await completeSignIn({ state: 'secret-1', code: 'google-code' });

    expect(completed).toEqual({ isOk: true, value: { fleetId: FLEET_ID, person: CHARLOTTE, request: REQUEST } });
    expect(providerSignIn.completed.map(({ code, redirectUri, verifier, nonce }) => ({ code, redirectUri, verifier, nonce }))).toEqual([{ code: 'google-code', redirectUri: SIGN_IN_CALLBACK, verifier: 'secret-3', nonce: 'secret-2' }]);
  });

  it('takes a sign-in once', async () => {
    await started();
    await completeSignIn({ state: 'secret-1', code: 'google-code' });

    await expect(completeSignIn({ state: 'secret-1', code: 'google-code' })).resolves.toMatchObject({ isOk: false, error: { kind: 'signInRefused' } });
  });

  it('refuses a sign-in after 10 minutes, and takes one just before', async () => {
    await started();
    now = new Date('2026-10-19T09:10:00.000Z');

    await expect(completeSignIn({ state: 'secret-1', code: 'google-code' })).resolves.toMatchObject({ isOk: false, error: { kind: 'signInRefused' } });

    await started();
    now = new Date('2026-10-19T09:19:59.999Z');
    await expect(completeSignIn({ state: 'secret-4', code: 'google-code' })).resolves.toMatchObject({ isOk: true });
  });

  it.each([
    { what: 'no state', callback: { code: 'google-code' } },
    { what: 'a state of no sign-in', callback: { state: 'forged', code: 'google-code' } },
    { what: 'no code', callback: { state: 'secret-1' } },
    { what: "the provider's refusal", callback: { state: 'secret-1', error: 'access_denied' } },
    { what: 'a code the provider does not vouch for', callback: { state: 'secret-1', code: 'other-code' } },
  ])('refuses $what, saying why', async ({ callback }) => {
    await started();

    const completed = await completeSignIn(callback);

    expect(completed).toMatchObject({ isOk: false, error: { kind: 'signInRefused' } });
    expect(completed.isOk ? '' : completed.error.message).not.toBe('');
  });
});
