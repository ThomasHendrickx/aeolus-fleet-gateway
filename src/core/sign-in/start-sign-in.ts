import type { OAuthSecrets } from '../oauth/ports.js';
import type { AuthorizationRefusal, ReadAuthorization } from '../oauth/read-authorization.js';
import type { Clock } from '../shared/clock.js';
import { ok, type Result } from '../shared/result.js';
import type { Pagasae, SignInSeals } from './ports.js';

/** How long a person has to sign in at pagasae and come back. */
export const SIGN_IN_LIFETIME_MS = 10 * 60_000;

export type StartSignIn = (request: Readonly<Record<string, string | undefined>>) => Promise<Result<{ redirectTo: string; browserSecret: string }, AuthorizationRefusal>>;

/**
 * Use case: a person, not argo, comes to /authorize from their MCP client
 * (Q25). The client's request is read as for argo, then sealed with the
 * gateway's own PKCE verifier into the state, and the person is sent to
 * pagasae naming no fleet, so pagasae answers their only fleet or asks
 * which (decision 0054). The browser is given a secret of its own, sealed
 * too, so only it finishes the sign-in.
 */
export function createStartSignIn(deps: { readAuthorization: ReadAuthorization; seals: SignInSeals; pagasae: Pagasae; secrets: OAuthSecrets; clock: Clock }): StartSignIn {
  return async (request) => {
    const read = await deps.readAuthorization(request);
    if (!read.isOk) {
      return read;
    }
    const verifier = deps.secrets.newSecret();
    const browserSecret = deps.secrets.newSecret();
    const state = deps.seals.seal({ verifier, browserSecret, request, expiresAt: new Date(deps.clock.now().getTime() + SIGN_IN_LIFETIME_MS) });
    return ok({ redirectTo: deps.pagasae.authorizeUrl({ state, codeChallenge: deps.secrets.challengeOf(verifier) }), browserSecret });
  };
}
