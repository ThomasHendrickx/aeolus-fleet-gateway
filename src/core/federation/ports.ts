import type { FleetId } from '@aeolus-fleet/common';

import type { Result } from '../shared/result.js';
import type { IdentityProvider, ProviderMetadata } from './identity-provider.js';

/** Outbound port: the fleets' identity providers, one per fleet. */
export interface IdentityProviders {
  find(fleetId: FleetId): Promise<IdentityProvider | undefined>;
  /** Keeps the fleet's provider, in place of the one before. */
  save(provider: IdentityProvider): Promise<void>;
}

/** Outbound port: an identity provider's OpenID configuration, read from its issuer. */
export interface ProviderDiscovery {
  discover(issuer: string): Promise<Result<ProviderMetadata, { reason: string }>>;
}
