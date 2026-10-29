import { beforeEach, describe, expect, it } from 'vitest';

import { ATTIO_CLIENT, aPartyGrant, fakePartySignIns, memoryPartyGrants } from '../../../test/support/party-grant-fakes.js';
import { createRefreshGrant } from './refresh-grant.js';

const AT = new Date('2026-10-28T16:00:00.000Z');

let grants: ReturnType<typeof memoryPartyGrants>;
let attio: ReturnType<typeof fakePartySignIns>;
let refresh: ReturnType<typeof createRefreshGrant>;

beforeEach(async () => {
  grants = memoryPartyGrants();
  await grants.keep(aPartyGrant());
  attio = fakePartySignIns();
  attio.state.refreshes.set('refresh-mathilde', { accessToken: 'access-2', refreshToken: 'refresh-2', expiresInSeconds: 3600 });
  refresh = createRefreshGrant({ signIns: attio.signIns, grants, clock: { now: () => AT } });
});

describe("a grant is refreshed with its party's client when the server refused its access token (decision 0067)", () => {
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
    await expect(refresh({ client: ATTIO_CLIENT, grant: aPartyGrant({ refreshToken: null }) })).resolves.toEqual({ isOk: false, error: { kind: 'noRefreshToken' } });
    expect(attio.state.refreshed).toEqual([]);
  });

  it('answers the server\'s refusal, keeping the grant as it was', async () => {
    attio.state.refreshes.clear();

    await expect(refresh({ client: ATTIO_CLIENT, grant: aPartyGrant() })).resolves.toMatchObject({ isOk: false, error: { kind: 'refused', error: 'invalid_grant' } });
    expect(grants.held).toEqual([aPartyGrant()]);
  });

  it('answers that the server did not answer, keeping the grant as it was', async () => {
    attio.state.failure = { kind: 'unreachable', reason: 'connect ECONNREFUSED' };

    await expect(refresh({ client: ATTIO_CLIENT, grant: aPartyGrant() })).resolves.toEqual({ isOk: false, error: { kind: 'unreachable', reason: 'connect ECONNREFUSED' } });
    expect(grants.held).toEqual([aPartyGrant()]);
  });

  it('keeps no tokens over a grant a new sign-in replaced meanwhile', async () => {
    await grants.keep(aPartyGrant({ accessToken: 'access-signed-in-again', refreshToken: 'refresh-signed-in-again' }));

    await expect(refresh({ client: ATTIO_CLIENT, grant: aPartyGrant() })).resolves.toEqual({ isOk: false, error: { kind: 'replaced' } });
    expect(grants.held).toEqual([aPartyGrant({ accessToken: 'access-signed-in-again', refreshToken: 'refresh-signed-in-again' })]);
  });

  it('keeps no tokens for a grant removed meanwhile', async () => {
    await grants.remove(aPartyGrant().fleetId, { party: 'attio', personShipId: aPartyGrant().personShipId });

    await expect(refresh({ client: ATTIO_CLIENT, grant: aPartyGrant() })).resolves.toEqual({ isOk: false, error: { kind: 'replaced' } });
    expect(grants.held).toEqual([]);
  });
});
