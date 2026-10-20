import type { ShipId } from '@aeolus-fleet/common';

import type { AccountGrant, AccountGrants, Pagasae, PagasaeTokens, PendingSignIn, PendingSignIns } from '../../src/core/sign-in/ports.js';
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

export function memoryPendingSignIns(): PendingSignIns & { held: Map<string, PendingSignIn> } {
  const held = new Map<string, PendingSignIn>();
  return {
    held,
    save: (signIn) => {
      held.set(signIn.stateHash, signIn);
      return Promise.resolve();
    },
    take: (stateHash) => {
      const signIn = held.get(stateHash);
      held.delete(stateHash);
      return Promise.resolve(signIn);
    },
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
