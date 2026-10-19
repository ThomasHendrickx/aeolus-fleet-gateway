import type { FleetId } from '@aeolus-fleet/common';

import type { IdentityProvider, ProviderMetadata } from '../../src/core/federation/identity-provider.js';
import type { IdentityProviders, ProviderDiscovery } from '../../src/core/federation/ports.js';
import { err, ok } from '../../src/core/shared/result.js';

/** The company's identity provider in the tests, as Google states itself. */
export const GOOGLE_ISSUER = 'https://accounts.google.com';

/** An OpenID configuration as an identity provider publishes it, by its issuer. */
export function aProviderMetadata(issuer: string, overrides: Partial<ProviderMetadata> = {}): ProviderMetadata {
  return {
    issuer,
    authorizationEndpoint: `${issuer}/o/oauth2/v2/auth`,
    tokenEndpoint: `${issuer}/token`,
    jwksUri: `${issuer}/oauth2/v3/certs`,
    ...overrides,
  };
}

/** Identity providers that publish their configuration, by the issuer asked for; any other issuer cannot be read. */
export function fakeProviderDiscovery(published: Readonly<Record<string, ProviderMetadata>>): ProviderDiscovery & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    discover: (issuer) => {
      asked.push(issuer);
      const metadata = published[issuer];
      return Promise.resolve(metadata ? ok(metadata) : err({ reason: 'it answered 404' }));
    },
  };
}

/** The fleets' identity providers in memory, one per fleet. */
export function memoryIdentityProviders(): IdentityProviders & { held: Map<FleetId, IdentityProvider> } {
  const held = new Map<FleetId, IdentityProvider>();
  return {
    held,
    find: (fleetId) => Promise.resolve(held.get(fleetId)),
    save: (provider) => {
      held.set(provider.fleetId, provider);
      return Promise.resolve();
    },
  };
}
