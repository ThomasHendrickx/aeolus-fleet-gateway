/** Account disabling invalidates cached browser access as well as MCP grants, including exchanges already under way. */
import type { FleetId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { CHARLOTTE_ACCOUNT_TOKEN } from '../../../test/support/account-sign-in-fakes.js';
import { memoryArgoAccounts } from '../../../test/support/argo-inbox-fakes.js';
import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { memoryIssuedTokens } from '../../../test/support/oauth-fakes.js';
import { memoryAccountGrants } from '../../../test/support/sign-in-fakes.js';
import { err, ok, type Result } from '../shared/result.js';
import { createEndSignIns } from '../sign-in/end-sign-ins.js';
import { createAccountOfSignIn } from './account-of-sign-in.js';
import type { SharedAccountToken, SharedSignInRefusal } from './ports.js';

const clock = { now: () => new Date('2026-10-21T09:00:00.000Z') };
const asked = { fleetId: FLEET_ID, signIn: 'charlotte-browser' };

function cachedAccounts() {
  const held = new Map<string, SharedAccountToken>();
  const key = ({ fleetId, signIn }: { fleetId: FleetId; signIn: string }) => `${fleetId}/${signIn}`;
  const accountOf = createAccountOfSignIn({
    clock,
    argoAccounts: memoryArgoAccounts(),
    signIns: { accountToken: (request) => Promise.resolve(held.has(key(request)) ? ok(held.get(key(request)) ?? CHARLOTTE_ACCOUNT_TOKEN) : err({ kind: 'signedOut' as const })) },
  });
  return { held, key, accountOf, end: createEndSignIns({ grants: memoryAccountGrants(), tokens: memoryIssuedTokens(), accountOf }) };
}

describe('a disabled account has no cached browser access', () => {
  it('drops every browser of the account in the notified fleet, leaving other accounts and fleets alone', async () => {
    const cache = cachedAccounts();
    const sameAccount = [asked, { ...asked, signIn: 'charlotte-other-browser' }];
    const unaffected = [{ ...asked, fleetId: OTHER_FLEET_ID }, { ...asked, signIn: 'maya-browser' }];
    for (const request of [...sameAccount, ...unaffected]) {
      cache.held.set(cache.key(request), { ...CHARLOTTE_ACCOUNT_TOKEN, accountId: request.signIn === 'maya-browser' ? 'acc-maya' : 'acc-charlotte' });
      await cache.accountOf(request);
    }
    cache.held.clear();

    await cache.end({ fleetId: FLEET_ID, accountId: 'acc-charlotte' });
    await cache.end({ fleetId: FLEET_ID, accountId: 'acc-charlotte' });

    for (const request of sameAccount) expect(await cache.accountOf(request)).toEqual({ isOk: false, error: { kind: 'signedOut' } });
    for (const request of unaffected) expect((await cache.accountOf(request)).isOk).toBe(true);
  });

  it.each([600_000, 630_000])('refuses cached access after %i ms without renewal when the disable notification was lost', async (elapsedMs) => {
    let now = clock.now();
    const held = new Map<FleetId, SharedAccountToken>([[FLEET_ID, CHARLOTTE_ACCOUNT_TOKEN]]);
    const accountOf = createAccountOfSignIn({ clock: { now: () => now }, argoAccounts: memoryArgoAccounts(), signIns: {
      accountToken: ({ fleetId }) => Promise.resolve(held.has(fleetId) ? ok(CHARLOTTE_ACCOUNT_TOKEN) : err({ kind: 'signedOut' as const })),
    } });
    expect((await accountOf(asked)).isOk).toBe(true);
    held.clear();
    now = new Date(clock.now().getTime() + elapsedMs);

    expect(await accountOf(asked)).toEqual({ isOk: false, error: { kind: 'signedOut' } });
  });

  it.each([630_001, 630_002])('refuses a token whose exchange finishes after %i ms without successful renewal', async (elapsedMs) => {
    let now = clock.now();
    const exchange = Promise.withResolvers<Result<SharedAccountToken, SharedSignInRefusal>>();
    const accountOf = createAccountOfSignIn({ clock: { now: () => now }, argoAccounts: memoryArgoAccounts(), signIns: {
      accountToken: () => exchange.promise,
    } });
    const pending = accountOf(asked);
    now = new Date(clock.now().getTime() + elapsedMs);
    exchange.resolve(ok(CHARLOTTE_ACCOUNT_TOKEN));

    expect(await pending).toEqual({ isOk: false, error: { kind: 'signedOut' } });
  });

  it('accepts an exchanged token at the existing 30-second allowance', async () => {
    const accountOf = createAccountOfSignIn({ clock: { now: () => new Date('2026-10-21T09:10:30.000Z') }, argoAccounts: memoryArgoAccounts(), signIns: {
      accountToken: () => Promise.resolve(ok(CHARLOTTE_ACCOUNT_TOKEN)),
    } });

    expect(await accountOf(asked)).toEqual(ok(CHARLOTTE_ACCOUNT_TOKEN));
  });

  it('does not admit or cache a token returned by an exchange started before the account was disabled', async () => {
    const exchange = Promise.withResolvers<Result<SharedAccountToken, SharedSignInRefusal>>();
    let exchanges = 0;
    const accountOf = createAccountOfSignIn({ clock, argoAccounts: memoryArgoAccounts(), signIns: {
      accountToken: () => {
        exchanges += 1;
        return exchanges === 1 ? exchange.promise : Promise.resolve(err({ kind: 'signedOut' }));
      },
    } });
    const pending = accountOf(asked);
    await createEndSignIns({ grants: memoryAccountGrants(), tokens: memoryIssuedTokens(), accountOf })({ fleetId: FLEET_ID, accountId: 'acc-charlotte' });
    exchange.resolve(ok(CHARLOTTE_ACCOUNT_TOKEN));

    expect(await pending).toEqual({ isOk: false, error: { kind: 'signedOut' } });
    expect(await accountOf(asked)).toEqual({ isOk: false, error: { kind: 'signedOut' } });
  });
});
