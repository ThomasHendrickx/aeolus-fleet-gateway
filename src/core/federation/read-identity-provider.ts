import type { FleetId } from '@aeolus-fleet/common';

import { shownIdentityProvider, type ShownIdentityProvider } from './identity-provider.js';
import type { IdentityProviders } from './ports.js';

export type ReadIdentityProvider = (fleetId: FleetId) => Promise<ShownIdentityProvider | null>;

/** Use case: argo, or a viewer, reads the fleet's identity provider, never its secret; none before argo set one. */
export function createReadIdentityProvider(deps: { providers: IdentityProviders }): ReadIdentityProvider {
  return async (fleetId) => {
    const provider = await deps.providers.find(fleetId);
    return provider ? shownIdentityProvider(provider) : null;
  };
}
