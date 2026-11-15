import type { FleetId } from '@aeolus-fleet/common';

import { createNoteArgoAccount } from '../argo-inbox/note-argo-account.js';
import type { ArgoAccounts } from '../argo-inbox/ports.js';
import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import { ACCOUNT_TOKEN_MARGIN_MS } from '../sign-in/account-token.js';
import type { SharedAccountToken, SharedSignIn, SharedSignInRefusal } from './ports.js';

/** Core permits account tokens for 30 seconds after expiry (self-hosted sign-in, section 5). */
const ACCOUNT_TOKEN_ALLOWANCE_MS = 30_000;

export type AccountOfSignIn = ((asked: { signIn: string; fleetId: FleetId }) => Promise<Result<SharedAccountToken, SharedSignInRefusal>>) & {
  /** Drops every token kept for the sign-in, as when it is signed out here. */
  forget(signIn: string): void;
  /** Drops every browser token of a disabled account in the notified fleet, including exchanges under way. */
  forgetAccount(account: { fleetId: FleetId; accountId: string }): void;
};

/**
 * Use case: the account token a shared sign-in has in a fleet (header design
 * H5, accounts design A3). pagasae answers a fresh one at every exchange; the
 * gateway keeps it per sign-in and fleet until a minute before it ends, so a
 * page's many calls make one exchange, and a sign-out anywhere or a change of
 * rights lands at the next. A refusal is never kept, nor a token naming no
 * person ship, as core commissions one with the account's first ship and
 * pagasae within a minute (aeolus-fleet#1583); a sign-out here drops what
 * was kept at once. Account disabling also drops cached tokens and refuses
 * exchanges already under way. Each token exchanged is the account's latest word on
 * being allowed as argo (argo's inbox, AI9).
 */
export function createAccountOfSignIn(deps: { signIns: Pick<SharedSignIn, 'accountToken'>; argoAccounts: ArgoAccounts; clock: Clock }): AccountOfSignIn {
  const noteArgoAccount = createNoteArgoAccount({ accounts: deps.argoAccounts });
  const kept = new Map<string, SharedAccountToken>();
  const pending = new Set<{ fleetId: FleetId; invalidatedAccounts: Set<string> }>();
  const hasExpired = (token: SharedAccountToken) => token.endsAt.getTime() + ACCOUNT_TOKEN_ALLOWANCE_MS < deps.clock.now().getTime();
  const isFresh = (token: SharedAccountToken) => token.endsAt.getTime() - ACCOUNT_TOKEN_MARGIN_MS > deps.clock.now().getTime();

  const accountOf = async ({ signIn, fleetId }: { signIn: string; fleetId: FleetId }): Promise<Result<SharedAccountToken, SharedSignInRefusal>> => {
    const key = `${fleetId} ${signIn}`;
    const held = kept.get(key);
    if (held !== undefined && isFresh(held)) {
      return ok(held);
    }
    kept.delete(key);
    const exchange = { fleetId, invalidatedAccounts: new Set<string>() };
    pending.add(exchange);
    try {
      const exchanged = await deps.signIns.accountToken({ signIn, fleetId });
      if (exchanged.isOk && (hasExpired(exchanged.value) || exchange.invalidatedAccounts.has(exchanged.value.accountId))) {
        return err({ kind: 'signedOut' });
      }
      if (exchanged.isOk && exchanged.value.personShipId !== null) {
        for (const [other, token] of kept) {
          if (!isFresh(token)) {
            kept.delete(other);
          }
        }
        kept.set(key, exchanged.value);
        await noteArgoAccount(fleetId, exchanged.value);
        if (hasExpired(exchanged.value) || exchange.invalidatedAccounts.has(exchanged.value.accountId)) {
          kept.delete(key);
          return err({ kind: 'signedOut' });
        }
      }
      return exchanged;
    } finally {
      pending.delete(exchange);
    }
  };
  const forget = (signIn: string) => {
    for (const key of kept.keys()) {
      if (key.endsWith(` ${signIn}`)) {
        kept.delete(key);
      }
    }
  };
  const forgetAccount = ({ fleetId, accountId }: { fleetId: FleetId; accountId: string }) => {
    for (const [key, token] of kept) {
      if (key.startsWith(`${fleetId} `) && token.accountId === accountId) {
        kept.delete(key);
      }
    }
    for (const exchange of pending) {
      if (exchange.fleetId === fleetId) {
        exchange.invalidatedAccounts.add(accountId);
      }
    }
  };
  return Object.assign(accountOf, { forget, forgetAccount });
}
