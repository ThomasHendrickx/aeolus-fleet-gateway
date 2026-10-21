import type { Result } from '../shared/result.js';
import type { AccountOfSignIn } from './account-of-sign-in.js';
import type { SharedSignIn } from './ports.js';

export type SignOutAccount = (signIn: string) => Promise<Result<void, { kind: 'unavailable' }>>;

/**
 * Use case: a person signs out of the gateway's pages, which ends the shared
 * sign-in at pagasae, so every Aeolus app is signed out (header design H5).
 * The tokens the gateway kept for it go at once.
 */
export function createSignOutAccount(deps: { signIns: Pick<SharedSignIn, 'revoke'>; accountOf: Pick<AccountOfSignIn, 'forget'> }): SignOutAccount {
  return (signIn) => {
    deps.accountOf.forget(signIn);
    return deps.signIns.revoke(signIn);
  };
}
