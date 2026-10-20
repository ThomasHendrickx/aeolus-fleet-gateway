import type { ShipId } from '@aeolus-fleet/common';

import type { AccountGrant, AccountGrants, Pagasae, PagasaeTokens, PendingSignIn, SignInSeals } from '../../src/core/sign-in/ports.js';
import { err, ok } from '../../src/core/shared/result.js';

import { FLEET_ID } from './fleet-fakes.js';

export const PAGASAE_URL = 'https://pagasae.example.com';
export const PERSON_SHIP_ID: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8pp';

/** The tokens pagasae answers for Charlotte in the fleet, in a test. */
export const CHARLOTTE_TOKENS: PagasaeTokens = {
  accountToken: 'account-token-1',
  accountTokenExpiresAt: new Date('2026-10-19T09:10:00.000Z'),
  refreshToken: 'pagasae-refresh-1',
  fleetId: FLEET_ID,
  accountId: 'acc-charlotte',
  personShipId: PERSON_SHIP_ID,
};

/** Seals as a test reads them: numbered in the order they are made, opened from the same seals only. */
export function fakeSignInSeals(): SignInSeals & { held: Map<string, PendingSignIn> } {
  const held = new Map<string, PendingSignIn>();
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

export function memoryAccountGrants(): AccountGrants & { held: AccountGrant[] } {
  const held: AccountGrant[] = [];
  return {
    held,
    save: (grant) => {
      held.push(grant);
      return Promise.resolve();
    },
  };
}

/**
 * pagasae as a test sees it: its authorize address with the state and the
 * challenge in its query, and one code it redeems, for the verifier given.
 */
export function fakePagasae(redeemed: { code: string; verifier: string; tokens: PagasaeTokens } | { refusal: string }): Pagasae {
  return {
    authorizeUrl: ({ state, codeChallenge }) => `${PAGASAE_URL}/oauth/authorize?state=${state}&code_challenge=${codeChallenge}`,
    redeemCode: ({ code, verifier }) => {
      if ('refusal' in redeemed) {
        return Promise.resolve(err({ reason: redeemed.refusal }));
      }
      return Promise.resolve(code === redeemed.code && verifier === redeemed.verifier ? ok(redeemed.tokens) : err({ reason: 'invalid_grant' }));
    },
  };
}
