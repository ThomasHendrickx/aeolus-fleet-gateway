import type { OAuthSecrets } from '../oauth/ports.js';
import type { Clock } from '../shared/clock.js';
import { FIRST_PAGE } from '../sign-in/start-page-sign-in.js';
import { SIGN_IN_LIFETIME_MS } from '../sign-in/start-sign-in.js';
import type { AccountSignInSeals, SharedSignIn } from './ports.js';

export type StartAccountSignIn = (asked: { returnTo?: string | undefined }) => { redirectTo: string; browserSecret: string };

/** Whether the path is one of the gateway's own: one slash, then no second slash or backslash a browser reads as another site. */
function isOwnPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
}

/**
 * Use case: a person signs in to the gateway's pages with the shared account
 * sign-in (header design H5). The page to go back to is sealed with the
 * gateway's PKCE verifier into the state, and the person is sent to pagasae
 * naming no fleet. Only a path of the gateway's own is kept, so a sign-in
 * never sends the browser to another site. The browser is given a secret of
 * its own, sealed too, so only it finishes the sign-in.
 */
export function createStartAccountSignIn(deps: { seals: AccountSignInSeals; signIns: SharedSignIn; secrets: OAuthSecrets; clock: Clock }): StartAccountSignIn {
  return ({ returnTo }) => {
    const verifier = deps.secrets.newSecret();
    const browserSecret = deps.secrets.newSecret();
    const state = deps.seals.seal({
      returnTo: returnTo !== undefined && isOwnPath(returnTo) ? returnTo : FIRST_PAGE,
      verifier,
      browserSecret,
      expiresAt: new Date(deps.clock.now().getTime() + SIGN_IN_LIFETIME_MS),
    });
    return { redirectTo: deps.signIns.authorizeUrl({ state, codeChallenge: deps.secrets.challengeOf(verifier) }), browserSecret };
  };
}
