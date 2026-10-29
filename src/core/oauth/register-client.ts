import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { OAuthClients, OAuthSecrets } from './ports.js';
import { isRedirectUri, REDIRECT_URIS_MAX } from './redirect-uri.js';

export type RegisterClient = (input: {
  fleetId: FleetId;
  name: string;
  redirectUris: readonly string[];
  isConfidential: boolean;
}) => Promise<Result<{ clientId: string; clientSecret: string | null }, DomainError<'INVALID_REDIRECT_URIS'>>>;

/**
 * Use case: argo pre-registers an MCP client for its fleet, as MCP
 * 2026-07-28 deprecates dynamic registration. A confidential client gets a
 * secret, answered this once and kept only as its hash.
 */
export function createRegisterClient(deps: { clients: OAuthClients; secrets: OAuthSecrets }): RegisterClient {
  return async ({ fleetId, name, redirectUris, isConfidential }) => {
    if (redirectUris.length === 0 || redirectUris.length > REDIRECT_URIS_MAX || !redirectUris.every(isRedirectUri)) {
      return refuse('INVALID_REDIRECT_URIS', `A client registers 1 to ${String(REDIRECT_URIS_MAX)} redirect URIs, each https, or http on this machine, with no fragment`);
    }
    const clientId = `client-${deps.secrets.newSecret()}`;
    const clientSecret = isConfidential ? deps.secrets.newSecret() : null;
    await deps.clients.save({ clientId, fleetId, name, redirectUris: [...redirectUris], secretHash: clientSecret === null ? null : deps.secrets.hashOf(clientSecret), grant: 'authorizationCode' });
    return ok({ clientId, clientSecret });
  };
}
