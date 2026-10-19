import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { isIssuer, isSecureUrl, shownIdentityProvider, type ShownIdentityProvider } from './identity-provider.js';
import type { IdentityProviders, ProviderDiscovery } from './ports.js';

export type SetIdentityProvider = (input: {
  fleetId: FleetId;
  issuer: string;
  clientId: string;
  clientSecret: string;
}) => Promise<Result<ShownIdentityProvider, DomainError<'INVALID_ISSUER' | 'PROVIDER_UNUSABLE'>>>;

/**
 * Use case: argo sets the fleet's company identity provider. The gateway
 * keeps it only once the issuer's OpenID configuration names that same
 * issuer (OpenID Connect Discovery 4.3) and serves every endpoint securely,
 * so a sign-in never goes to a provider it could not use.
 */
export function createSetIdentityProvider(deps: { providers: IdentityProviders; discovery: ProviderDiscovery; clock: Clock }): SetIdentityProvider {
  return async ({ fleetId, issuer, clientId, clientSecret }) => {
    if (!isIssuer(issuer)) {
      return refuse('INVALID_ISSUER', 'An issuer is an https URL, or http on this machine, with no query or fragment');
    }
    const discovered = await deps.discovery.discover(issuer);
    if (!discovered.isOk) {
      return refuse('PROVIDER_UNUSABLE', `The gateway could not read ${issuer}'s OpenID configuration: ${discovered.error.reason}`);
    }
    const metadata = discovered.value;
    if (metadata.issuer !== issuer) {
      return refuse('PROVIDER_UNUSABLE', `${issuer}'s OpenID configuration names another issuer, ${metadata.issuer}`);
    }
    if (![metadata.authorizationEndpoint, metadata.tokenEndpoint, metadata.jwksUri].every(isSecureUrl)) {
      return refuse('PROVIDER_UNUSABLE', `${issuer}'s OpenID configuration serves an endpoint over plain http off this machine`);
    }
    const provider = { fleetId, issuer, clientId, clientSecret, setAt: deps.clock.now() };
    await deps.providers.save(provider);
    return ok(shownIdentityProvider(provider));
  };
}
