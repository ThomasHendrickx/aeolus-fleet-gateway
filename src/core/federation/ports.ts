import type { FleetId } from '@aeolus-fleet/common';

import type { Result } from '../shared/result.js';
import type { IdentityProvider, ProviderMetadata } from './identity-provider.js';
import type { SignedInPerson, SignIn } from './sign-in.js';

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

/** Outbound port: the sign-ins under way, by their state's hash. */
export interface SignIns {
  save(signIn: SignIn): Promise<void>;
  /** The sign-in, handed to one take only: a second take of the same state finds none. */
  take(stateHash: string): Promise<SignIn | undefined>;
}

/** Outbound port: the provider's side of a sign-in, once the person came back with a code. */
export interface ProviderSignIn {
  /** Takes the code for an ID token at the provider, and checks the token: its signature, issuer, audience, expiry and nonce. */
  complete(input: { provider: IdentityProvider; metadata: ProviderMetadata; code: string; redirectUri: string; verifier: string; nonce: string }): Promise<Result<SignedInPerson, { reason: string }>>;
}
