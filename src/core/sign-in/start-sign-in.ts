import type { OAuthSecrets } from '../oauth/ports.js';
import type { AuthorizationRefusal, ReadAuthorization } from '../oauth/read-authorization.js';
import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { Pagasae, SignInHolder, SignInSeals } from './ports.js';

/** How long a person has to sign in at pagasae and come back. */
export const SIGN_IN_LIFETIME_MS = 10 * 60_000;

export type StartSignIn = (picked: { request: Readonly<Record<string, string | undefined>>; holder: SignInHolder }) => Promise<Result<{ redirectTo: string; browserSecret: string }, AuthorizationRefusal>>;

/**
 * Use case: a person comes to /authorize from their MCP client (Q25) and
 * picks what it acts as: their account, or a party they ask access for (Q1
 * a). The client's request is read, then sealed, with that pick, with the
 * gateway's own PKCE verifier into the state, and the person is sent to
 * pagasae naming no fleet, so pagasae answers their only fleet or asks
 * which (decision 0054). The browser is given a secret of its own, sealed
 * too, so only it finishes the sign-in. The plugin's address signs the
 * person in as themselves only: no one asks for access for a client there
 * (chatgpt-plugin design, 6).
 */
export function createStartSignIn(deps: { readAuthorization: ReadAuthorization; pluginResource: string; seals: SignInSeals; pagasae: Pagasae; secrets: OAuthSecrets; clock: Clock }): StartSignIn {
  return async ({ request, holder }) => {
    const read = await deps.readAuthorization(request);
    if (!read.isOk) {
      return read;
    }
    if (holder === 'party' && read.value.resource === deps.pluginResource) {
      const { redirectUri, state } = read.value;
      return err({ kind: 'redirect', redirectUri, error: 'invalid_request', description: 'The plugin address signs in as yourself only', state });
    }
    const verifier = deps.secrets.newSecret();
    const browserSecret = deps.secrets.newSecret();
    const state = deps.seals.seal({ verifier, browserSecret, request, holder, expiresAt: new Date(deps.clock.now().getTime() + SIGN_IN_LIFETIME_MS) });
    return ok({ redirectTo: deps.pagasae.authorizeUrl({ state, codeChallenge: deps.secrets.challengeOf(verifier) }), browserSecret });
  };
}
