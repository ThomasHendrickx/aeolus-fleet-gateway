import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { IssuedTokens, OAuthSecrets } from './ports.js';

/** Who calls with an access token: the fleet and the client it was issued to. */
export interface AccessTokenHolder {
  readonly fleetId: FleetId;
  readonly clientId: string;
  readonly scope: string | null;
}

export type AuthenticateAccessToken = (accessToken: string) => Promise<Result<AccessTokenHolder, { kind: 'invalidToken' }>>;

/**
 * Use case: the gateway knows an MCP client by its access token: active,
 * not expired, and issued for the gateway's own MCP endpoint (RFC 8707).
 */
export function createAuthenticateAccessToken(deps: { tokens: IssuedTokens; secrets: OAuthSecrets; clock: Clock; resource: string }): AuthenticateAccessToken {
  return async (accessToken) => {
    const pair = await deps.tokens.findByAccess(deps.secrets.hashOf(accessToken));
    if (pair?.state !== 'active' || pair.resource !== deps.resource || pair.accessExpiresAt.getTime() <= deps.clock.now().getTime()) {
      return err({ kind: 'invalidToken' });
    }
    return ok({ fleetId: pair.fleetId, clientId: pair.clientId, scope: pair.scope });
  };
}
