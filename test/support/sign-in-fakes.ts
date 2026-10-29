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
  scopes: ['fleet:read', 'gateway:approve'],
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
  const indexOf = (fleetId: string, grantId: string) => held.findIndex((grant) => grant.fleetId === fleetId && grant.grantId === grantId);
  return {
    held,
    save: (grant) => {
      held.push(grant);
      return Promise.resolve();
    },
    find: (fleetId, grantId) => Promise.resolve(held[indexOf(fleetId, grantId)]),
    ofAccount: (fleetId, accountId) => Promise.resolve(held.filter((grant) => grant.fleetId === fleetId && grant.accountId === accountId)),
    renew: ({ fleetId, grantId }, tokens) => {
      const index = indexOf(fleetId, grantId);
      const grant = held[index];
      if (grant !== undefined) {
        held[index] = { ...grant, ...tokens };
      }
      return Promise.resolve();
    },
    end: (fleetId, grantId) => {
      const index = indexOf(fleetId, grantId);
      if (index >= 0) {
        held.splice(index, 1);
      }
      return Promise.resolve();
    },
  };
}

/**
 * pagasae as a test hands it ID-JAGs (company sign-in design, slice 6): the
 * account's grant for each it takes, by its text, every other refused, and
 * each handed over, with the client that brought it.
 */
export function fakeIdJagPagasae(idJags: Readonly<Record<string, PagasaeTokens | 'refused' | 'unavailable'>>): Pick<Pagasae, 'exchangeIdJag'> & { handedOver: { idJag: string; clientId: string }[] } {
  const handedOver: { idJag: string; clientId: string }[] = [];
  return {
    handedOver,
    exchangeIdJag: (handed) => {
      handedOver.push(handed);
      const answer = idJags[handed.idJag] ?? 'refused';
      if (answer === 'refused' || answer === 'unavailable') {
        return Promise.resolve(err({ kind: answer, reason: answer === 'refused' ? 'invalid_grant' : 'pagasae did not answer' }));
      }
      return Promise.resolve(ok(answer));
    },
  };
}

/**
 * pagasae as a test sees it: its authorize address with the state and the
 * challenge in its query, and one code it redeems, for the verifier given.
 * It takes no ID-JAG.
 */
export function fakePagasae(
  redeemed: { code: string; verifier: string; tokens: PagasaeTokens } | { refusal: string },
  refreshes: Readonly<Record<string, PagasaeTokens | 'refused' | 'unavailable'>> = {},
): Pagasae & { refreshed: string[] } {
  const refreshed: string[] = [];
  return {
    refreshed,
    exchangeIdJag: () => Promise.resolve(err({ kind: 'refused', reason: 'invalid_grant' })),
    refresh: async (refreshToken) => {
      refreshed.push(refreshToken);
      // A turn of the event loop, as a call over the network takes, so calls made together overlap.
      await Promise.resolve();
      const answer = refreshes[refreshToken] ?? 'refused';
      if (answer === 'refused' || answer === 'unavailable') {
        return err({ kind: answer, reason: answer === 'refused' ? 'invalid_grant' : 'pagasae did not answer' });
      }
      return ok(answer);
    },
    authorizeUrl: ({ state, codeChallenge }) => `${PAGASAE_URL}/oauth/authorize?state=${state}&code_challenge=${codeChallenge}`,
    redeemCode: ({ code, verifier }) => {
      if ('refusal' in redeemed) {
        return Promise.resolve(err({ reason: redeemed.refusal }));
      }
      return Promise.resolve(code === redeemed.code && verifier === redeemed.verifier ? ok(redeemed.tokens) : err({ reason: 'invalid_grant' }));
    },
  };
}
