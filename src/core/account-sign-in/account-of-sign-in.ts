import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { ok, type Result } from '../shared/result.js';
import { ACCOUNT_TOKEN_MARGIN_MS } from '../sign-in/account-token.js';
import type { SharedAccountToken, SharedSignIn, SharedSignInRefusal } from './ports.js';

export type AccountOfSignIn = ((asked: { signIn: string; fleetId: FleetId }) => Promise<Result<SharedAccountToken, SharedSignInRefusal>>) & {
  /** Drops every token kept for the sign-in, as when it is signed out here. */
  forget(signIn: string): void;
};

/**
 * Use case: the account token a shared sign-in has in a fleet (header design
 * H5, accounts design A3). pagasae answers a fresh one at every exchange; the
 * gateway keeps it per sign-in and fleet until a minute before it ends, so a
 * page's many calls make one exchange, and a sign-out anywhere or a change of
 * rights lands at the next. A refusal is never kept, and a sign-out here
 * drops what was kept at once.
 */
export function createAccountOfSignIn(deps: { signIns: Pick<SharedSignIn, 'accountToken'>; clock: Clock }): AccountOfSignIn {
  const kept = new Map<string, SharedAccountToken>();
  const isFresh = (token: SharedAccountToken) => token.endsAt.getTime() - ACCOUNT_TOKEN_MARGIN_MS > deps.clock.now().getTime();

  const accountOf = async ({ signIn, fleetId }: { signIn: string; fleetId: FleetId }) => {
    const key = `${fleetId} ${signIn}`;
    const held = kept.get(key);
    if (held !== undefined && isFresh(held)) {
      return ok(held);
    }
    kept.delete(key);
    const exchanged = await deps.signIns.accountToken({ signIn, fleetId });
    if (exchanged.isOk) {
      for (const [other, token] of kept) {
        if (!isFresh(token)) {
          kept.delete(other);
        }
      }
      kept.set(key, exchanged.value);
    }
    return exchanged;
  };
  const forget = (signIn: string) => {
    for (const key of kept.keys()) {
      if (key.endsWith(` ${signIn}`)) {
        kept.delete(key);
      }
    }
  };
  return Object.assign(accountOf, { forget });
}
