import { beforeEach, describe, expect, it } from 'vitest';

import { aProviderMetadata, fakeProviderDiscovery, GOOGLE_ISSUER, memoryIdentityProviders } from '../../../test/support/federation-fakes.js';
import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import type { Clock } from '../shared/clock.js';
import { createReadIdentityProvider } from './read-identity-provider.js';
import { createSetIdentityProvider } from './set-identity-provider.js';

const NOW = new Date('2026-10-19T12:00:00.000Z');
const clock: Clock = { now: () => NOW };
const GOOGLE = { fleetId: FLEET_ID, issuer: GOOGLE_ISSUER, clientId: 'gateway.apps.googleusercontent.com', clientSecret: 'google-secret' };

let providers: ReturnType<typeof memoryIdentityProviders>;
let discovery: ReturnType<typeof fakeProviderDiscovery>;
let setIdentityProvider: ReturnType<typeof createSetIdentityProvider>;

beforeEach(() => {
  providers = memoryIdentityProviders();
  discovery = fakeProviderDiscovery({ [GOOGLE_ISSUER]: aProviderMetadata(GOOGLE_ISSUER), 'http://127.0.0.1:8080/default': aProviderMetadata('http://127.0.0.1:8080/default') });
  setIdentityProvider = createSetIdentityProvider({ providers, discovery, clock });
});

describe("argo sets the fleet's company identity provider, which people sign in with (interop I-4)", () => {
  it('keeps it, with its client secret in the vault, once its OpenID configuration names it', async () => {
    const set = await setIdentityProvider(GOOGLE);

    expect(set).toEqual({ isOk: true, value: { issuer: GOOGLE_ISSUER, clientId: 'gateway.apps.googleusercontent.com', setAt: NOW } });
    expect(discovery.asked).toEqual([GOOGLE_ISSUER]);
    expect(providers.held.get(FLEET_ID)).toEqual({ ...GOOGLE, setAt: NOW });
  });

  it('replaces the one argo set before', async () => {
    await setIdentityProvider({ ...GOOGLE, clientSecret: 'old-secret' });

    await setIdentityProvider(GOOGLE);

    expect(providers.held.get(FLEET_ID)?.clientSecret).toBe('google-secret');
  });

  it('takes a provider served over plain http on this machine, as a local test provider is', async () => {
    await expect(setIdentityProvider({ ...GOOGLE, issuer: 'http://127.0.0.1:8080/default' })).resolves.toMatchObject({ isOk: true });
  });

  it.each([
    { what: 'an issuer that is no URL', issuer: 'accounts.google.com' },
    { what: 'an issuer served over plain http off this machine', issuer: 'http://accounts.google.com' },
    { what: 'an issuer with a query', issuer: 'https://accounts.google.com?tenant=1' },
    { what: 'an issuer with a fragment', issuer: 'https://accounts.google.com#a' },
  ])('refuses $what, asking nothing', async ({ issuer }) => {
    await expect(setIdentityProvider({ ...GOOGLE, issuer })).resolves.toMatchObject({ isOk: false, error: { kind: 'INVALID_ISSUER' } });
    expect(discovery.asked).toEqual([]);
    expect(providers.held.size).toBe(0);
  });

  it('refuses an issuer whose OpenID configuration it cannot read, saying why', async () => {
    await expect(setIdentityProvider({ ...GOOGLE, issuer: 'https://login.example.com' })).resolves.toEqual({
      isOk: false,
      error: { kind: 'PROVIDER_UNUSABLE', message: "The gateway could not read https://login.example.com's OpenID configuration: it answered 404" },
    });
    expect(providers.held.size).toBe(0);
  });

  it('refuses a configuration that names another issuer (OpenID Connect Discovery 4.3)', async () => {
    discovery = fakeProviderDiscovery({ 'https://login.example.com': aProviderMetadata('https://evil.example.com') });

    await expect(createSetIdentityProvider({ providers, discovery, clock })({ ...GOOGLE, issuer: 'https://login.example.com' })).resolves.toMatchObject({ isOk: false, error: { kind: 'PROVIDER_UNUSABLE' } });
    expect(providers.held.size).toBe(0);
  });

  it.each([
    { what: 'its authorization endpoint', overrides: { authorizationEndpoint: 'http://accounts.google.com/auth' } },
    { what: 'its token endpoint', overrides: { tokenEndpoint: 'http://accounts.google.com/token' } },
    { what: 'its keys', overrides: { jwksUri: 'http://accounts.google.com/certs' } },
  ])('refuses a configuration that serves $what over plain http off this machine', async ({ overrides }) => {
    discovery = fakeProviderDiscovery({ [GOOGLE_ISSUER]: aProviderMetadata(GOOGLE_ISSUER, overrides) });

    await expect(createSetIdentityProvider({ providers, discovery, clock })(GOOGLE)).resolves.toMatchObject({ isOk: false, error: { kind: 'PROVIDER_UNUSABLE' } });
    expect(providers.held.size).toBe(0);
  });
});

describe("argo reads the fleet's identity provider", () => {
  it('reads none before argo set one', async () => {
    await expect(createReadIdentityProvider({ providers })(FLEET_ID)).resolves.toBeNull();
  });

  it("reads its issuer and client id, never its secret, and only its own fleet's", async () => {
    await setIdentityProvider(GOOGLE);
    const readIdentityProvider = createReadIdentityProvider({ providers });

    await expect(readIdentityProvider(FLEET_ID)).resolves.toEqual({ issuer: GOOGLE_ISSUER, clientId: 'gateway.apps.googleusercontent.com', setAt: NOW });
    await expect(readIdentityProvider(OTHER_FLEET_ID)).resolves.toBeNull();
  });
});
