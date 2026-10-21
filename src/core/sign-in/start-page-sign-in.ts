import type { OAuthSecrets } from '../oauth/ports.js';
import type { Clock } from '../shared/clock.js';
import { ownPageOf } from './own-page.js';
import type { Pagasae, SignInSeals } from './ports.js';
import { SIGN_IN_LIFETIME_MS } from './start-sign-in.js';

/** Where a person lands once signed in, when they asked for no page of the gateway's own. */
export const FIRST_PAGE = '/overview';

export type StartPageSignIn = (asked: { returnTo?: string | undefined }) => { redirectTo: string; browserSecret: string };

/**
 * Use case: a person signs in to the gateway's own pages through pagasae
 * (decision 0054), as from an MCP client: the page to go back to is sealed
 * with the gateway's PKCE verifier into the state, and the person is sent to
 * pagasae naming no fleet. Only a path of the gateway's own is kept, so a
 * sign-in never sends the browser to another site. The browser is given a
 * secret of its own, sealed too, so only it finishes the sign-in.
 */
export function createStartPageSignIn(deps: { seals: SignInSeals; pagasae: Pagasae; secrets: OAuthSecrets; clock: Clock }): StartPageSignIn {
  return ({ returnTo }) => {
    const verifier = deps.secrets.newSecret();
    const browserSecret = deps.secrets.newSecret();
    const state = deps.seals.seal({
      holder: 'page',
      returnTo: (returnTo === undefined ? undefined : ownPageOf(returnTo)) ?? FIRST_PAGE,
      verifier,
      browserSecret,
      expiresAt: new Date(deps.clock.now().getTime() + SIGN_IN_LIFETIME_MS),
    });
    return { redirectTo: deps.pagasae.authorizeUrl({ state, codeChallenge: deps.secrets.challengeOf(verifier) }), browserSecret };
  };
}
