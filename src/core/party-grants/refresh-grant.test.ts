import { beforeEach, describe, expect, it } from 'vitest';

import { ATTIO_CLIENT, aPartyGrant, fakePartySignIns, memoryPartyGrants } from '../../../test/support/party-grant-fakes.js';
import { createRefreshGrant } from './refresh-grant.js';
import type { TellSignInNeeded } from './tell-sign-in-needed.js';

const AT = new Date('2026-10-28T16:00:00.000Z');

let grants: ReturnType<typeof memoryPartyGrants>;
let attio: ReturnType<typeof fakePartySignIns>;
let refresh: ReturnType<typeof createRefreshGrant>;
let told: Parameters<TellSignInNeeded>[0][];

beforeEach(async () => {
  grants = memoryPartyGrants();
  await grants.keep(aPartyGrant());
  attio = fakePartySignIns();
  attio.state.refreshes.set('refresh-mathilde', { accessToken: 'access-2', refreshToken: 'refresh-2', expiresInSeconds: 3600 });
  told = [];
  const tellSignInNeeded: TellSignInNeeded = (input) => {
    told.push(input);
    return Promise.resolve();
  };
  refresh = createRefreshGrant({ signIns: attio.signIns, grants, tellSignInNeeded, clock: { now: () => AT } });
});

describe("a grant is refreshed with its party's client (decision 0067)", () => {
  it('answers and keeps the new access and refresh tokens, with when the access token ends', async () => {
    const refreshed = await refresh({ client: ATTIO_CLIENT, grant: aPartyGrant() });

    const expected = aPartyGrant({ accessToken: 'access-2', refreshToken: 'refresh-2', accessTokenEndsAt: new Date('2026-10-28T17:00:00.000Z') });
    expect(refreshed).toEqual({ isOk: true, value: expected });
    expect(grants.held).toEqual([expected]);
  });

  it("asks the party's client with the grant's refresh token", async () => {
    await refresh({ client: ATTIO_CLIENT, grant: aPartyGrant() });

    expect(attio.state.refreshed).toEqual([{ clientId: 'client-1', refreshToken: 'refresh-mathilde' }]);
  });

  it('keeps the refresh token it held when the server issues no new one', async () => {
    attio.state.refreshes.set('refresh-mathilde', { accessToken: 'access-2', refreshToken: null, expiresInSeconds: null });

    await refresh({ client: ATTIO_CLIENT, grant: aPartyGrant() });

    expect(grants.held).toEqual([aPartyGrant({ accessToken: 'access-2', refreshToken: 'refresh-mathilde', accessTokenEndsAt: null })]);
  });

  it('refreshes nothing for a grant the server issued no refresh token', async () => {
    await grants.keep(aPartyGrant({ refreshToken: null }));

    await expect(refresh({ client: ATTIO_CLIENT, grant: aPartyGrant({ refreshToken: null }) })).resolves.toEqual({ isOk: false, error: { kind: 'noRefreshToken' } });
    expect(attio.state.refreshed).toEqual([]);
  });

  it('answers that the server did not answer, keeping the grant as it was', async () => {
    attio.state.failure = { kind: 'unreachable', reason: 'connect ECONNREFUSED' };

    await expect(refresh({ client: ATTIO_CLIENT, grant: aPartyGrant() })).resolves.toEqual({ isOk: false, error: { kind: 'unreachable', reason: 'connect ECONNREFUSED' } });
    expect(grants.held).toEqual([aPartyGrant()]);
  });

  it('answers that no grant is held for one removed meanwhile, refreshing nothing', async () => {
    await grants.remove(aPartyGrant().fleetId, { party: 'attio', personShipId: aPartyGrant().personShipId });

    await expect(refresh({ client: ATTIO_CLIENT, grant: aPartyGrant() })).resolves.toEqual({ isOk: false, error: { kind: 'removed' } });
    expect(attio.state.refreshed).toEqual([]);
    expect(grants.held).toEqual([]);
  });
});

describe('one refresh at a time per grant (Q7, L19)', () => {
  it('runs one refresh for two asked at once, and both answer the new tokens (scenario 17)', async () => {
    const [one, other] = await Promise.all([refresh({ client: ATTIO_CLIENT, grant: aPartyGrant() }), refresh({ client: ATTIO_CLIENT, grant: aPartyGrant() })]);

    expect(attio.state.refreshed).toEqual([{ clientId: 'client-1', refreshToken: 'refresh-mathilde' }]);
    expect(one).toMatchObject({ isOk: true, value: { accessToken: 'access-2', refreshToken: 'refresh-2' } });
    expect(other).toMatchObject({ isOk: true, value: { accessToken: 'access-2', refreshToken: 'refresh-2' } });
  });

  it('answers the grant as held, refreshing nothing, when a refresh meanwhile already replaced the access token it was asked for', async () => {
    await grants.keep(aPartyGrant({ accessToken: 'access-2', refreshToken: 'refresh-2' }));

    await expect(refresh({ client: ATTIO_CLIENT, grant: aPartyGrant() })).resolves.toEqual({ isOk: true, value: aPartyGrant({ accessToken: 'access-2', refreshToken: 'refresh-2' }) });
    expect(attio.state.refreshed).toEqual([]);
  });

  it('answers the new grant, refreshing nothing, when the person signed in again meanwhile', async () => {
    await grants.keep(aPartyGrant({ accessToken: 'access-signed-in-again', refreshToken: 'refresh-signed-in-again' }));

    await expect(refresh({ client: ATTIO_CLIENT, grant: aPartyGrant() })).resolves.toMatchObject({ isOk: true, value: { accessToken: 'access-signed-in-again' } });
    expect(attio.state.refreshed).toEqual([]);
  });
});

describe('a refresh the server answers invalid_grant loses the grant (Q5, Q6)', () => {
  const LOST = { at: AT, why: 'invalid_grant: the refresh token is unknown or used' };

  it('keeps the grant lost, with when and why, and answers it lost (scenario 19)', async () => {
    attio.state.refreshes.clear();

    await expect(refresh({ client: ATTIO_CLIENT, grant: aPartyGrant() })).resolves.toEqual({ isOk: false, error: { kind: 'lost', lost: LOST } });
    expect(grants.held).toEqual([aPartyGrant({ lost: LOST })]);
  });

  it('tells the person their sign-in ended (scenario 19)', async () => {
    attio.state.refreshes.clear();

    await refresh({ client: ATTIO_CLIENT, grant: aPartyGrant() });

    expect(told).toEqual([{ fleetId: aPartyGrant().fleetId, party: 'attio', personShipId: aPartyGrant().personShipId, lost: LOST }]);
  });

  it('answers it lost, refreshing nothing and telling no one again, when another refresh lost it meanwhile', async () => {
    await grants.keep(aPartyGrant({ lost: LOST }));

    await expect(refresh({ client: ATTIO_CLIENT, grant: aPartyGrant() })).resolves.toEqual({ isOk: false, error: { kind: 'lost', lost: LOST } });
    expect(attio.state.refreshed).toEqual([]);
    expect(told).toEqual([]);
  });

  it('answers another refusal of the server, keeping the grant as it was and telling no one', async () => {
    attio.state.failure = { kind: 'refused', error: 'invalid_client', reason: 'invalid_client: the client is unknown' };

    await expect(refresh({ client: ATTIO_CLIENT, grant: aPartyGrant() })).resolves.toEqual({ isOk: false, error: { kind: 'refused', error: 'invalid_client', reason: 'invalid_client: the client is unknown' } });
    expect(grants.held).toEqual([aPartyGrant()]);
    expect(told).toEqual([]);
  });
});
