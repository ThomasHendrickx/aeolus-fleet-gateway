import type { OAuthSecrets } from '../oauth/ports.js';
import type { Clock } from '../shared/clock.js';
import type { Pagasae, SignInSeals } from './ports.js';
import { SIGN_IN_LIFETIME_MS } from './start-sign-in.js';

/** Where a person lands once signed in, when they asked for no page of the gateway's own. */
export const FIRST_PAGE = '/overview';

export type StartPageSignIn = (asked: { returnTo?: string | undefined }) => { redirectTo: string; browserSecret: string };

/**
 * The page on the gateway itself the return address names, as its path,
 * query and hash, or none. It is read as a browser reads it, against the
 * gateway's own origin, so tabs, newlines and backslashes cannot hide another
 * site.
 */
function ownPageOf(returnTo: string, origin: string): string | undefined {
  const page = URL.parse(returnTo, origin);
  return page?.origin === new URL(origin).origin ? `${page.pathname}${page.search}${page.hash}` : undefined;
}

/**
 * Use case: a person signs in to the gateway's own pages through pagasae
 * (decision 0054), as from an MCP client: the page to go back to is sealed
 * with the gateway's PKCE verifier into the state, and the person is sent to
 * pagasae naming no fleet. Only a page on the gateway itself is kept, so a
 * sign-in never sends the browser to another site. The browser is given a
 * secret of its own, sealed too, so only it finishes the sign-in.
 */
export function createStartPageSignIn(deps: { seals: SignInSeals; pagasae: Pagasae; secrets: OAuthSecrets; clock: Clock; origin: string }): StartPageSignIn {
  return ({ returnTo }) => {
    const verifier = deps.secrets.newSecret();
    const browserSecret = deps.secrets.newSecret();
    const state = deps.seals.seal({
      holder: 'page',
      returnTo: (returnTo === undefined ? undefined : ownPageOf(returnTo, deps.origin)) ?? FIRST_PAGE,
      verifier,
      browserSecret,
      expiresAt: new Date(deps.clock.now().getTime() + SIGN_IN_LIFETIME_MS),
    });
    return { redirectTo: deps.pagasae.authorizeUrl({ state, codeChallenge: deps.secrets.challengeOf(verifier) }), browserSecret };
  };
}
