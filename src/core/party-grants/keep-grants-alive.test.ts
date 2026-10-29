import { beforeEach, describe, expect, it } from 'vitest';

import { memoryPartyStore } from '../../../test/support/party-fakes.js';
import { anAttioParty, aPartyGrant, fakePartySignIns, JORIS_SHIP_ID, memoryPartyGrants } from '../../../test/support/party-grant-fakes.js';
import { signInServersOf } from '../parties/sign-in-servers.js';
import { createKeepGrantsAlive } from './keep-grants-alive.js';
import { createRefreshGrant } from './refresh-grant.js';
import type { TellSignInNeeded } from './tell-sign-in-needed.js';

/** A day and a minute after Mathilde signed in, at 14:00 the day before. */
const NOW = new Date('2026-10-29T14:01:00.000Z');
/** An access token that ends long after now. */
const LATER = new Date('2026-10-29T20:00:00.000Z');

let grants: ReturnType<typeof memoryPartyGrants>;
let attio: ReturnType<typeof fakePartySignIns>;
let told: Parameters<TellSignInNeeded>[0][];
let keepAlive: ReturnType<typeof createKeepGrantsAlive>;

beforeEach(async () => {
  grants = memoryPartyGrants();
  attio = fakePartySignIns();
  attio.state.refreshes.set('refresh-mathilde', { accessToken: 'access-2', refreshToken: 'refresh-2', expiresInSeconds: 3600 });
  const parties = memoryPartyStore();
  await parties.save(anAttioParty());
  told = [];
  const tellSignInNeeded: TellSignInNeeded = (input) => {
    told.push(input);
    return Promise.resolve();
  };
  const clock = { now: () => NOW };
  keepAlive = createKeepGrantsAlive({ grants, servers: signInServersOf(parties), refreshGrant: createRefreshGrant({ signIns: attio.signIns, grants, tellSignInNeeded, clock }), clock });
});

describe('the gateway keeps grants alive on a schedule, without a call (decision 0067, Q7)', () => {
  it('refreshes a grant idle for longer than a day, keeping the new refresh token before it is used (scenario 21)', async () => {
    await grants.keep(aPartyGrant({ accessTokenEndsAt: LATER }));

    await keepAlive();

    expect(attio.state.refreshed).toEqual([{ clientId: 'client-1', refreshToken: 'refresh-mathilde' }]);
    expect(grants.held).toEqual([aPartyGrant({ accessToken: 'access-2', refreshToken: 'refresh-2', accessTokenEndsAt: new Date('2026-10-29T15:01:00.000Z'), refreshedAt: NOW })]);
  });

  it('counts a grant idle from its last refresh, not its sign-in', async () => {
    await grants.keep(aPartyGrant({ accessTokenEndsAt: LATER, refreshedAt: new Date('2026-10-29T09:00:00.000Z') }));

    await keepAlive();

    expect(attio.state.refreshed).toEqual([]);
  });

  it('leaves a grant signed in within the day', async () => {
    await grants.keep(aPartyGrant({ accessTokenEndsAt: LATER, signedInAt: new Date('2026-10-28T14:02:00.000Z') }));

    await keepAlive();

    expect(attio.state.refreshed).toEqual([]);
  });

  it('refreshes a grant whose access token ends within ten minutes, though it is not idle', async () => {
    await grants.keep(aPartyGrant({ accessTokenEndsAt: new Date('2026-10-29T14:10:00.000Z'), refreshedAt: new Date('2026-10-29T13:10:00.000Z') }));

    await keepAlive();

    expect(attio.state.refreshed).toHaveLength(1);
  });

  it('leaves a lost grant, and one that holds no refresh token', async () => {
    await grants.keep(aPartyGrant({ lost: { at: new Date('2026-10-29T09:00:00.000Z'), why: 'invalid_grant' } }));
    await grants.keep(aPartyGrant({ personShipId: JORIS_SHIP_ID, accountId: 'acc-joris', outsideAccount: { subject: 'sub-2', name: null }, refreshToken: null }));

    await keepAlive();

    expect(attio.state.refreshed).toEqual([]);
  });

  it('loses a grant whose refresh answers invalid_grant and tells the person, before any call needs it (Q7)', async () => {
    await grants.keep(aPartyGrant({ accessTokenEndsAt: LATER }));
    attio.state.refreshes.clear();

    await keepAlive();

    expect(grants.held).toMatchObject([{ lost: { at: NOW } }]);
    expect(told).toMatchObject([{ party: 'attio', personShipId: aPartyGrant().personShipId, lost: { at: NOW } }]);
  });

  it('keeps a grant whose refresh the authorization server did not answer, and tries it again at the next round (scenario 20)', async () => {
    await grants.keep(aPartyGrant({ accessTokenEndsAt: LATER }));
    attio.state.failure = { kind: 'unreachable', reason: 'connect ECONNREFUSED' };
    await keepAlive();
    attio.state.failure = undefined;

    await keepAlive();

    expect(grants.held).toMatchObject([{ accessToken: 'access-2', refreshToken: 'refresh-2' }]);
    expect(told).toEqual([]);
  });

  it('leaves a grant of a party that is no longer a server where each person signs in', async () => {
    await grants.keep(aPartyGrant({ party: 'gone', accessTokenEndsAt: LATER }));

    await keepAlive();

    expect(attio.state.refreshed).toEqual([]);
  });
});
