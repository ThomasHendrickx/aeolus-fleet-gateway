import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { OWNER_SHIP_ID } from '../../../test/support/party-fakes.js';
import { memoryPendingRequests } from '../../../test/support/request-fakes.js';
import { createExpireRequests } from './expire-requests.js';
import type { PendingRequest } from './ports.js';

// A request no approver decided in 7 days expires (decision 0056), and a
// person who asked for a server hears it, as they hear a decision (P5-1 a).

const EXPIRES_AT = new Date('2026-10-27T09:00:00.000Z');
const CHARLOTTE = { accountId: 'acc-charlotte', personShipId: OWNER_SHIP_ID };

function aRequest(overrides: Partial<PendingRequest>): PendingRequest {
  return {
    fleetId: FLEET_ID,
    requestId: 'req_1',
    subject: { kind: 'server', url: 'https://mcp.linear.app/mcp' },
    requesters: [CHARLOTTE],
    askedAt: new Date('2026-10-20T09:00:00.000Z'),
    expiresAt: EXPIRES_AT,
    state: 'pending',
    decidedBy: null,
    decidedAt: null,
    ...overrides,
  };
}

let requests: ReturnType<typeof memoryPendingRequests>;

beforeEach(() => {
  requests = memoryPendingRequests();
});

function expireRequests(now: Date) {
  return createExpireRequests({ requests, clock: { now: () => now } })();
}

describe('expiring the requests no approver decided in 7 days', () => {
  it('expires each pending request due by now, in every fleet, and writes its expiry to tell', async () => {
    requests.held.push(aRequest({}), aRequest({ fleetId: OTHER_FLEET_ID, subject: { kind: 'client', clientId: 'https://orderbot.example.com/client.json', clientName: 'Orderbot' } }));

    await expect(expireRequests(EXPIRES_AT)).resolves.toBe(2);
    expect({ states: requests.held.map(({ state }) => state), notices: requests.notices }).toEqual({
      states: ['expired', 'expired'],
      notices: [{ fleetId: FLEET_ID, requestId: 'req_1', accountId: 'acc-charlotte', personShipId: OWNER_SHIP_ID, url: 'https://mcp.linear.app/mcp', outcome: 'expired', partyName: null, isEnded: false }],
    });
  });

  it('leaves a request due a moment later, and one being approved', async () => {
    requests.held.push(aRequest({ expiresAt: new Date('2026-10-27T09:00:00.001Z') }), aRequest({ requestId: 'req_2', subject: { kind: 'server', url: 'https://mcp.notion.com/mcp' }, state: 'approving' }));

    await expect(expireRequests(EXPIRES_AT)).resolves.toBe(0);
    expect(requests.held.map(({ state }) => state)).toEqual(['pending', 'approving']);
  });

  it('expires a request once', async () => {
    requests.held.push(aRequest({}));
    await expireRequests(EXPIRES_AT);

    await expect(expireRequests(EXPIRES_AT)).resolves.toBe(0);
    expect(requests.notices).toHaveLength(1);
  });
});
