import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { memoryIssuedTokens } from '../../../test/support/oauth-fakes.js';
import { CHARLOTTE_TOKENS, fakePagasae, memoryAccountGrants, PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { PagasaeTokens } from './ports.js';
import { createAccountTokenOf } from './account-token.js';

// A signed-in person's calls go to core as their account, each with a
// fresh account token (decisions 0054, 0058): it lasts 10 minutes, so the
// gateway refreshes it through pagasae before it ends.

const GRANT = { fleetId: FLEET_ID, grantId: 'grant-1' };
const REFRESHED: PagasaeTokens = { ...CHARLOTTE_TOKENS, accountToken: 'account-token-2', accountTokenExpiresAt: new Date('2026-10-19T09:19:00.000Z'), refreshToken: 'pagasae-refresh-2' };

let now: Date;
let grants: ReturnType<typeof memoryAccountGrants>;
let tokens: ReturnType<typeof memoryIssuedTokens>;

beforeEach(async () => {
  now = new Date('2026-10-19T09:00:00.000Z');
  grants = memoryAccountGrants();
  await grants.save({ ...GRANT, accountId: 'acc-charlotte', personShipId: PERSON_SHIP_ID, scopes: ['fleet:read'], refreshToken: 'pagasae-refresh-1', accountToken: 'account-token-1', accountTokenExpiresAt: new Date('2026-10-19T09:10:00.000Z') });
  tokens = memoryIssuedTokens();
  const pair = { familyId: 'family-1', codeHash: 'code-1', fleetId: FLEET_ID, clientId: 'client-1', resource: 'http://gateway.example.com/mcp', scope: null, accessExpiresAt: now, refreshExpiresAt: now };
  await tokens.save({ ...pair, kind: 'account', grantId: 'grant-1', accessHash: 'access-1', refreshHash: 'refresh-1' });
  await tokens.save({ ...pair, kind: 'party', party: 'claude', accessHash: 'access-2', refreshHash: 'refresh-2' });
});

function accountTokenOf(pagasae = fakePagasae({ refusal: 'unused' }, { 'pagasae-refresh-1': REFRESHED })) {
  return { pagasae, accountTokenOf: createAccountTokenOf({ grants, tokens, pagasae, clock: { now: () => now } }) };
}

describe("a signed-in person's account token", () => {
  it('is the one the grant holds while over a minute of it is left, asking pagasae nothing', async () => {
    now = new Date('2026-10-19T09:08:59.999Z');
    const { pagasae, accountTokenOf: tokenOf } = accountTokenOf();

    await expect(tokenOf(GRANT)).resolves.toEqual({ isOk: true, value: { accountToken: 'account-token-1', accountId: 'acc-charlotte', personShipId: PERSON_SHIP_ID, scopes: ['fleet:read'] } });
    expect(pagasae.refreshed).toEqual([]);
  });

  it("is refreshed through pagasae a minute before it ends, and the grant keeps pagasae's new tokens and the scopes they carry", async () => {
    now = new Date('2026-10-19T09:09:00.000Z');

    await expect(accountTokenOf().accountTokenOf(GRANT)).resolves.toEqual({ isOk: true, value: { accountToken: 'account-token-2', accountId: 'acc-charlotte', personShipId: PERSON_SHIP_ID, scopes: ['fleet:read', 'gateway:approve'] } });
    expect(grants.held).toMatchObject([{ refreshToken: 'pagasae-refresh-2', accountToken: 'account-token-2', accountTokenExpiresAt: new Date('2026-10-19T09:19:00.000Z'), scopes: ['fleet:read', 'gateway:approve'] }]);
  });

  it('is refreshed once for calls made together, as pagasae ends a grant whose refresh token comes twice', async () => {
    now = new Date('2026-10-19T09:09:30.000Z');
    const { pagasae, accountTokenOf: tokenOf } = accountTokenOf();

    const answers = await Promise.all([tokenOf(GRANT), tokenOf(GRANT), tokenOf(GRANT)]);

    expect({ refreshed: pagasae.refreshed, tokens: answers.map((answer) => (answer.isOk ? answer.value.accountToken : answer.error.kind)) }).toEqual({
      refreshed: ['pagasae-refresh-1'],
      tokens: ['account-token-2', 'account-token-2', 'account-token-2'],
    });
  });

  it('takes the person ship pagasae names at the refresh, as the account may have gained one', async () => {
    now = new Date('2026-10-19T09:09:30.000Z');
    await grants.renew(GRANT, { personShipId: null });

    await expect(accountTokenOf().accountTokenOf(GRANT)).resolves.toMatchObject({ isOk: true, value: { personShipId: PERSON_SHIP_ID } });
  });

  it("ends the grant when pagasae refuses its refresh token: the client's tokens are revoked, so it signs in again", async () => {
    now = new Date('2026-10-19T09:09:30.000Z');

    await expect(accountTokenOf(fakePagasae({ refusal: 'unused' }, { 'pagasae-refresh-1': 'refused' })).accountTokenOf(GRANT)).resolves.toEqual({ isOk: false, error: { kind: 'signedOut' } });
    expect({ grants: grants.held.length, states: tokens.held.map(({ state }) => state) }).toEqual({ grants: 0, states: ['revoked', 'active'] });
  });

  it('ends the grant when pagasae answers a token for another fleet', async () => {
    now = new Date('2026-10-19T09:09:30.000Z');

    await expect(accountTokenOf(fakePagasae({ refusal: 'unused' }, { 'pagasae-refresh-1': { ...REFRESHED, fleetId: OTHER_FLEET_ID } })).accountTokenOf(GRANT)).resolves.toEqual({ isOk: false, error: { kind: 'signedOut' } });
    expect(grants.held).toEqual([]);
  });

  it('keeps the grant when pagasae does not answer, saying so', async () => {
    now = new Date('2026-10-19T09:09:30.000Z');

    await expect(accountTokenOf(fakePagasae({ refusal: 'unused' }, { 'pagasae-refresh-1': 'unavailable' })).accountTokenOf(GRANT)).resolves.toEqual({ isOk: false, error: { kind: 'pagasaeUnavailable' } });
    expect(grants.held).toHaveLength(1);
  });

  it('is none for a grant the gateway does not hold, or holds in another fleet', async () => {
    const { accountTokenOf: tokenOf } = accountTokenOf();

    await expect(Promise.all([tokenOf({ fleetId: FLEET_ID, grantId: 'grant-9' }), tokenOf({ fleetId: OTHER_FLEET_ID, grantId: 'grant-1' })])).resolves.toEqual([
      { isOk: false, error: { kind: 'signedOut' } },
      { isOk: false, error: { kind: 'signedOut' } },
    ]);
  });
});
