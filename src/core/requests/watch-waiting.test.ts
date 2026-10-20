import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { memoryAuthorizationCodes, RESOURCE } from '../../../test/support/oauth-fakes.js';
import { OWNER_SHIP_ID, PROXY_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import { fakeWaitingSeals, memoryPendingRequests } from '../../../test/support/request-fakes.js';
import type { McpClientParty } from '../parties/party.js';
import type { PendingRequest } from './ports.js';
import { createWatchWaiting } from './watch-waiting.js';

// The waiting page follows its request live: whether the browser that asked
// still waits, read with no side effect (no code issued, nobody told), so
// the page goes on to the waiting page's own answer only once it is decided.

const CLIENT_ID = 'https://orderbot.example.com/client.json';
const CALLBACK = 'https://orderbot.example.com/callback';
const REQUEST = { response_type: 'code', client_id: CLIENT_ID, redirect_uri: CALLBACK, code_challenge: 'S256(verifier-1)', code_challenge_method: 'S256', resource: RESOURCE, state: 'state-1' };
const EXPIRES_AT = new Date('2026-10-27T09:00:00.000Z');
const PENDING: PendingRequest = {
  fleetId: FLEET_ID,
  requestId: 'req_1',
  subject: { kind: 'client', clientId: CLIENT_ID, clientName: 'Orderbot' },
  requesters: [{ accountId: 'acc-charlotte', personShipId: null }],
  askedAt: new Date('2026-10-20T09:00:00.000Z'),
  expiresAt: EXPIRES_AT,
  state: 'pending',
  decidedBy: null,
  decidedAt: null,
};
const PARTY: McpClientParty = {
  fleetId: FLEET_ID,
  name: 'orderbot',
  kind: 'mcpClient',
  clientId: CLIENT_ID,
  ownerShipId: OWNER_SHIP_ID,
  state: 'crewed',
  proxyShipId: PROXY_SHIP_ID,
  secret: null,
  crewToken: 'aeolus_ct_v1_orderbot',
  requestId: 'req_1',
  requestHash: 'h',
  approvedAt: new Date('2026-10-20T09:00:00.000Z'),
};

let now: Date;
let requests: ReturnType<typeof memoryPendingRequests>;
let parties: ReturnType<typeof memoryPartyStore>;
let codes: ReturnType<typeof memoryAuthorizationCodes>;
let waitings: ReturnType<typeof fakeWaitingSeals>;

beforeEach(() => {
  now = new Date('2026-10-21T09:00:00.000Z');
  requests = memoryPendingRequests();
  requests.held.push(PENDING);
  parties = memoryPartyStore();
  codes = memoryAuthorizationCodes();
  waitings = fakeWaitingSeals();
  waitings.seal({ fleetId: FLEET_ID, requestId: 'req_1', accountId: 'acc-charlotte', browserSecret: 'browser-1', request: REQUEST });
});

function watchWaiting() {
  return createWatchWaiting({ waitings, requests, parties, clock: { now: () => now } });
}

function decided(state: 'approved' | 'denied') {
  requests.held.splice(0, 1, { ...PENDING, state, decidedBy: { kind: 'operator' }, decidedAt: now });
}

describe('the waiting page follows its request', () => {
  it('still waits while the request is pending, naming its fleet and when it expires', async () => {
    await expect(watchWaiting()({ waiting: 'waiting-1', browserSecret: 'browser-1' })).resolves.toEqual({ isOk: true, value: { fleetId: FLEET_ID, isWaiting: true, expiresAt: EXPIRES_AT } });
  });

  it('still waits while an approved party awaits crew', async () => {
    decided('approved');
    await parties.save({ ...PARTY, state: 'awaitingCrew', crewToken: null });

    await expect(watchWaiting()({ waiting: 'waiting-1', browserSecret: 'browser-1' })).resolves.toMatchObject({ isOk: true, value: { isWaiting: true } });
  });

  it('waits no more once approved and crewed, issuing no code', async () => {
    decided('approved');
    await parties.save(PARTY);

    await expect(watchWaiting()({ waiting: 'waiting-1', browserSecret: 'browser-1' })).resolves.toMatchObject({ isOk: true, value: { isWaiting: false } });
    expect(codes.held.size).toBe(0);
  });

  it('waits no more once denied, telling nobody', async () => {
    decided('denied');

    await expect(watchWaiting()({ waiting: 'waiting-1', browserSecret: 'browser-1' })).resolves.toMatchObject({ isOk: true, value: { isWaiting: false } });
    expect([...requests.told]).toEqual([]);
  });

  it('waits no more once the request expired, and not a moment before', async () => {
    now = new Date('2026-10-27T08:59:59.999Z');
    const before = await watchWaiting()({ waiting: 'waiting-1', browserSecret: 'browser-1' });
    now = EXPIRES_AT;

    await expect(watchWaiting()({ waiting: 'waiting-1', browserSecret: 'browser-1' })).resolves.toMatchObject({ isOk: true, value: { isWaiting: false } });
    expect(before).toMatchObject({ isOk: true, value: { isWaiting: true } });
  });

  it('refuses a waiting it did not seal, one whose request is forgotten, and another browser', async () => {
    const unsealed = await watchWaiting()({ waiting: 'waiting-9', browserSecret: 'browser-1' });
    const otherBrowser = await watchWaiting()({ waiting: 'waiting-1', browserSecret: 'browser-2' });
    requests.held.splice(0, 1);

    await expect(watchWaiting()({ waiting: 'waiting-1', browserSecret: 'browser-1' })).resolves.toEqual({ isOk: false, error: { kind: 'unknownWaiting' } });
    expect(unsealed).toEqual({ isOk: false, error: { kind: 'unknownWaiting' } });
    expect(otherBrowser).toEqual({ isOk: false, error: { kind: 'otherBrowser' } });
  });
});
