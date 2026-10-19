import type { Clock } from '../shared/clock.js';
import type { AuthorizationCodes, OAuthSecrets } from './ports.js';
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
 * Issues a code for an authorization request the gateway granted, bound to
 * the client, the party it calls the fleet as, its redirect URI, its PKCE
 * challenge and the resource; only the code's hash is kept. Where the client
 * is sent back to with it, and with the issuer (RFC 9207).
 */
export async function issueCode(
  deps: { codes: AuthorizationCodes; secrets: OAuthSecrets; clock: Clock; issuer: string },
  granted: { authorization: AuthorizationRequest; party: string },
): Promise<string> {
  const { authorization, party } = granted;
  const code = deps.secrets.newSecret();
  await deps.codes.save({
    codeHash: deps.secrets.hashOf(code),
    fleetId: authorization.fleetId,
    clientId: authorization.clientId,
    redirectUri: authorization.redirectUri,
    codeChallenge: authorization.codeChallenge,
    resource: authorization.resource,
    scope: authorization.scope,
    party,
    expiresAt: new Date(deps.clock.now().getTime() + CODE_LIFETIME_MS),
  });
  return redirectWith(authorization.redirectUri, { code, state: authorization.state, iss: deps.issuer });
}
