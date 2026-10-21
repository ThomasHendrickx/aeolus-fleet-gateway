import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { AccountSignInSeals, SharedSignIn } from './ports.js';

/**
 * Why a sign-in sent the person nowhere:
 * - unknownSignIn: the gateway sealed no sign-in into this state, or its 10 minutes passed;
 * - otherBrowser: the browser that came back does not hold the sign-in's secret, as when another site makes it finish its own;
 * - pagasaeRefused: pagasae sent no code, or did not redeem it, for the reason given.
 */
export type AccountSignInRefusal = { readonly kind: 'unknownSignIn' } | { readonly kind: 'otherBrowser' } | { readonly kind: 'pagasaeRefused'; readonly message: string };

export type CompleteAccountSignIn = (back: {
  state?: string | undefined;
  code?: string | undefined;
  error?: string | undefined;
  browserSecret?: string | undefined;
}) => Promise<Result<{ redirectTo: string }, AccountSignInRefusal>>;

/**
 * Use case: pagasae sends the person back. Their sign-in is opened from its
 * state, and pagasae's code redeemed with the gateway's verifier, which
 * proves the round trip; the shared sign-in is then the browser's, in
 * pagasae's cookie, and the gateway keeps nothing. The person goes back to
 * the page they asked for.
 */
export function createCompleteAccountSignIn(deps: { seals: AccountSignInSeals; signIns: SharedSignIn; clock: Clock }): CompleteAccountSignIn {
  return async ({ state, code, error, browserSecret }) => {
    const signIn = state === undefined ? undefined : deps.seals.open(state);
    if (signIn === undefined || signIn.expiresAt.getTime() <= deps.clock.now().getTime()) {
      return err({ kind: 'unknownSignIn' });
    }
    if (browserSecret !== signIn.browserSecret) {
      return err({ kind: 'otherBrowser' });
    }
    if (error !== undefined || code === undefined) {
      return err({ kind: 'pagasaeRefused', message: error ?? 'pagasae sent no code' });
    }
    const redeemed = await deps.signIns.redeemCode({ code, verifier: signIn.verifier });
    return redeemed.isOk ? ok({ redirectTo: signIn.returnTo }) : err({ kind: 'pagasaeRefused', message: redeemed.error.reason });
  };
}
