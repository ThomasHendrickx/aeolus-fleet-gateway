import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { AuthorizationCodes, OAuthSecrets } from './ports.js';
import type { AuthorizationRefusal, ReadAuthorization } from './read-authorization.js';

/** How long a code may be taken for tokens: one minute, within OAuth's ten (RFC 6749, 4.1.2). */
export const CODE_LIFETIME_MS = 60_000;

export type ApproveAuthorization = (input: {
  fleetId: FleetId;
  request: Readonly<Record<string, string | undefined>>;
  isApproved: boolean;
}) => Promise<Result<{ redirectTo: string }, AuthorizationRefusal>>;

/** The client's redirect URI with the answer's parameters added, its own query kept. */
function redirectWith(redirectUri: string, parameters: Record<string, string | null>): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== null) {
      url.searchParams.append(name, value);
    }
  }
  return url.toString();
}

/**
 * Use case: argo, signed in to the console, approves or denies an MCP
 * client's authorization request for argo's fleet. The request is read
 * again, so nothing changed on the way is taken. An approval issues a code
 * bound to the client, its redirect URI, its PKCE challenge and the
 * resource; the client is sent back with it, and with the issuer (RFC 9207).
 */
export function createApproveAuthorization(deps: { readAuthorization: ReadAuthorization; codes: AuthorizationCodes; secrets: OAuthSecrets; clock: Clock; issuer: string }): ApproveAuthorization {
  return async ({ fleetId, request, isApproved }) => {
    const read = await deps.readAuthorization(request);
    if (!read.isOk) {
      return read;
    }
    const authorization = read.value;
    if (authorization.clientFleetId !== null && authorization.clientFleetId !== fleetId) {
      return err({ kind: 'invalidClient', message: `${authorization.clientName} is registered for another fleet` });
    }
    if (!isApproved) {
      return ok({ redirectTo: redirectWith(authorization.redirectUri, { error: 'access_denied', state: authorization.state, iss: deps.issuer }) });
    }
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
    });
    return ok({ redirectTo: redirectWith(authorization.redirectUri, { code, state: authorization.state, iss: deps.issuer }) });
  };
}
