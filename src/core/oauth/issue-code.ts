import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import type { AuthorizationCodes, OAuthSecrets, TokenHolder } from './ports.js';
import type { AuthorizationRequest } from './read-authorization.js';

/** How long a code may be taken for tokens: one minute, within OAuth's ten (RFC 6749, 4.1.2). */
export const CODE_LIFETIME_MS = 60_000;

/** The client's redirect URI with the answer's parameters added, its own query kept. */
export function redirectWith(redirectUri: string, parameters: Record<string, string | null>): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== null) {
      url.searchParams.append(name, value);
    }
  }
  return url.toString();
}

/**
 * Issues a code bound to the client, its redirect URI, its PKCE challenge,
 * the resource and whom it stands for, in the fleet; answers where the client
 * is sent back with it and with the issuer (RFC 9207).
 */
export async function issueCode(
  deps: { codes: AuthorizationCodes; secrets: OAuthSecrets; clock: Clock; issuer: string },
  issued: { fleetId: FleetId; authorization: AuthorizationRequest; holder: TokenHolder },
): Promise<string> {
  const { fleetId, authorization, holder } = issued;
  const code = deps.secrets.newSecret();
  await deps.codes.save({
    codeHash: deps.secrets.hashOf(code),
    fleetId,
    clientId: authorization.clientId,
    redirectUri: authorization.redirectUri,
    codeChallenge: authorization.codeChallenge,
    resource: authorization.resource,
    scope: authorization.scope,
    expiresAt: new Date(deps.clock.now().getTime() + CODE_LIFETIME_MS),
    ...holder,
  });
  return redirectWith(authorization.redirectUri, { code, state: authorization.state, iss: deps.issuer });
}
