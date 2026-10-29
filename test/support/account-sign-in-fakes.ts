import type { FleetId } from '@aeolus-fleet/common';

import type { AccountSignInSeals, AccountSignInUnderWay, OpenableApps, SharedAccountToken, SharedSignIn } from '../../src/core/account-sign-in/ports.js';
import { err, ok } from '../../src/core/shared/result.js';

import { FLEET_ID, OTHER_FLEET_ID } from './fleet-fakes.js';
import { PAGASAE_URL, PERSON_SHIP_ID } from './sign-in-fakes.js';

/** Charlotte's shared sign-in, as her browser holds it in pagasae's cookie. */
export const CHARLOTTE_SIGN_IN = 'charlotte-sign-in';

/** The account token pagasae answers for Charlotte in the fleet. */
export const CHARLOTTE_ACCOUNT_TOKEN: SharedAccountToken = {
  accountToken: 'account-token-1',
  endsAt: new Date('2026-10-21T09:10:00.000Z'),
  accountId: 'acc-charlotte',
  personShipId: PERSON_SHIP_ID,
  scopes: ['fleet:read', 'gateway:approve'],
};

export const ACCOUNT_URL = `${PAGASAE_URL}/account`;
export const CONSOLE_URL = 'https://fleet.example.com';
export const GATEWAY_URL = 'https://gateway.example.com';

/** Charlotte's account, as pagasae names it. */
export const CHARLOTTE = { id: 'acc-charlotte', email: 'charlotte@example.com' };

/** What Charlotte may open: the gateway in the other fleet only, the console in both. */
export const CHARLOTTE_APPS: OpenableApps = {
  account: CHARLOTTE,
  apps: [{ app: 'account', url: ACCOUNT_URL }],
  fleets: [
    { fleetId: FLEET_ID, name: 'Acme', apps: [{ app: 'console', url: CONSOLE_URL }] },
    { fleetId: OTHER_FLEET_ID, name: 'Labs', apps: [{ app: 'console', url: CONSOLE_URL }, { app: 'gateway', url: GATEWAY_URL }] },
  ],
};

/** Seals as a test reads them: numbered in the order they are made, opened from the same seals only. */
export function fakeAccountSignInSeals(): AccountSignInSeals & { held: Map<string, AccountSignInUnderWay> } {
  const held = new Map<string, AccountSignInUnderWay>();
  return {
    held,
    seal: (signIn) => {
      const state = `sealed-${String(held.size + 1)}`;
      held.set(state, signIn);
      return state;
    },
    open: (state) => held.get(state),
  };
}

/**
 * pagasae as the gateway's pages' app client, in a test: it redeems the one
 * code for the one verifier, and for Charlotte's shared sign-in answers her
 * token in the fleets the test gives her, counting each exchange, until it
 * is revoked. Unavailable, it answers nothing.
 */
export function fakeSharedSignIn(setting: {
  code?: { code: string; verifier: string };
  tokens?: ReadonlyMap<FleetId, SharedAccountToken>;
  apps?: OpenableApps;
  isAvailable?: boolean;
}): SharedSignIn & { exchanges: number; revoked: string[] } {
  const revoked: string[] = [];
  const isAvailable = setting.isAvailable ?? true;
  const isSignedIn = (signIn: string) => signIn === CHARLOTTE_SIGN_IN && !revoked.includes(signIn);
  const fake = {
    exchanges: 0,
    revoked,
    authorizeUrl: ({ state, codeChallenge }: { state: string; codeChallenge: string }) => `${PAGASAE_URL}/oauth/authorize?state=${state}&code_challenge=${codeChallenge}`,
    redeemCode: ({ code, verifier }: { code: string; verifier: string }) =>
      Promise.resolve(setting.code?.code === code && setting.code.verifier === verifier ? ok(undefined) : err({ reason: 'invalid_grant' })),
    accountToken: ({ signIn, fleetId }: { signIn: string; fleetId: FleetId }) => {
      fake.exchanges += 1;
      if (!isAvailable) {
        return Promise.resolve(err({ kind: 'unavailable' as const }));
      }
      if (!isSignedIn(signIn)) {
        return Promise.resolve(err({ kind: 'signedOut' as const }));
      }
      const token = setting.tokens?.get(fleetId);
      return Promise.resolve(token === undefined ? err({ kind: 'noRights' as const }) : ok(token));
    },
    apps: (signIn: string) => {
      if (!isAvailable) {
        return Promise.resolve(err({ kind: 'unavailable' as const }));
      }
      return Promise.resolve(isSignedIn(signIn) ? ok(setting.apps ?? CHARLOTTE_APPS) : err({ kind: 'signedOut' as const }));
    },
    revoke: (signIn: string) => {
      if (!isAvailable) {
        return Promise.resolve(err({ kind: 'unavailable' as const }));
      }
      revoked.push(signIn);
      return Promise.resolve(ok(undefined));
    },
  };
  return fake;
}
