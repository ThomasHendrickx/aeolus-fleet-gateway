import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { memoryPendingRequests } from '../../../test/support/request-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { createListMine } from './list-mine.js';
import type { PendingRequest } from './ports.js';

// Your requests on the overview (decision 0056): the requests an account
// asked, in any state, the newest first.

const NOW = new Date('2026-10-28T09:00:00.000Z');
const CHARLOTTE: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-charlotte', personShipId: null, grantId: 'grant-1', scopes: ['fleet:read'] };

function aRequest(request: Partial<PendingRequest> & Pick<PendingRequest, 'requestId'>): PendingRequest {
  return {
    fleetId: FLEET_ID,
    subject: { kind: 'server', url: `https://${request.requestId}.example.com/mcp` },
    requesters: [{ accountId: 'acc-charlotte', personShipId: null }],
    askedAt: new Date('2026-10-25T09:00:00.000Z'),
    expiresAt: new Date('2026-11-01T09:00:00.000Z'),
    state: 'pending',
    decidedBy: null,
    decidedAt: null,
    ...request,
  };
}

function listMine(held: PendingRequest[]) {
  const requests = memoryPendingRequests();
  requests.held.push(...held);
  return createListMine({ requests, clock: { now: () => NOW } });
}

describe('the requests an account asked', () => {
  it('lists its own, in any state, the newest first', async () => {
    const older = aRequest({ requestId: 'req_older', askedAt: new Date('2026-10-24T09:00:00.000Z'), state: 'denied' });
    const newer = aRequest({ requestId: 'req_newer', askedAt: new Date('2026-10-26T09:00:00.000Z') });
    const joined = aRequest({ requestId: 'req_joined', requesters: [{ accountId: 'acc-pieter', personShipId: null }, { accountId: 'acc-charlotte', personShipId: null }] });

    const listed = await listMine([older, newer, joined])(CHARLOTTE);

    expect(listed).toEqual({ isOk: true, value: [newer, joined, older] });
  });

  it("leaves out another account's and another fleet's", async () => {
    const pieters = aRequest({ requestId: 'req_pieter', requesters: [{ accountId: 'acc-pieter', personShipId: null }] });
    const otherFleet = aRequest({ requestId: 'req_other', fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8zz' });

    await expect(listMine([pieters, otherFleet])(CHARLOTTE)).resolves.toEqual({ isOk: true, value: [] });
  });

  it('reads a pending request past its 7 days as expired', async () => {
    const lapsed = aRequest({ requestId: 'req_lapsed', expiresAt: NOW });

    await expect(listMine([lapsed])(CHARLOTTE)).resolves.toEqual({ isOk: true, value: [{ ...lapsed, state: 'expired' }] });
  });

  it('refuses an actor that is no account: only an account asks', async () => {
    const operator: Actor = { fleetId: FLEET_ID, kind: 'operator', scopes: ['fleet:read'] };

    await expect(listMine([])(operator)).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_AN_ACCOUNT' } });
  });
});
