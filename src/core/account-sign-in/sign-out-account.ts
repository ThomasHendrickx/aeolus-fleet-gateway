import type { Result } from '../shared/result.js';
import type { SharedSignIn } from './ports.js';

export type SignOutAccount = (signIn: string) => Promise<Result<void, { kind: 'unavailable' }>>;

/** Use case: a person signs out of the gateway's pages, which ends the shared sign-in at pagasae, so every Aeolus app is signed out (header design H5). */
export function createSignOutAccount(deps: { signIns: SharedSignIn }): SignOutAccount {
  return (signIn) => deps.signIns.revoke(signIn);
}
