import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { memoryPendingRequests } from '../../../test/support/request-fakes.js';
import { createOpenRequest } from './open-request.js';

// A pending request for an outside party (decision 0056): an outside MCP
// client's authorize request, or a person's request for an outside MCP
// server, kept 7 days in one list. A second request for the same client or
// server joins the one pending.

const ASKED_AT = new Date('2026-10-20T09:00:00.000Z');
const CHARLOTTE = { accountId: 'acc-charlotte', personShipId: 'shp_01m3tb1zgr5h2ffee12xnch8pp' as const satisfies ShipId };
const PIETER = { accountId: 'acc-pieter', personShipId: null };
const ORDERBOT = { kind: 'client' as const, clientId: 'https://orderbot.example.com/client.json', clientName: 'Orderbot' };
const LINEAR = { kind: 'server' as const, url: 'https://mcp.linear.app/mcp' };

let requests: ReturnType<typeof memoryPendingRequests>;
let now: Date;
let ids: number;

beforeEach(() => {
  requests = memoryPendingRequests();
  now = ASKED_AT;
  ids = 0;
});

function openRequest() {
  return createOpenRequest({
    requests,
    ids: { newRequestId: () => `req_${String((ids += 1))}` },
    clock: { now: () => now },
  });
}

describe('opening a pending request', () => {
  it('keeps a new request, pending for 7 days, with its requester', async () => {
    await expect(openRequest()({ fleetId: FLEET_ID, subject: ORDERBOT, requester: CHARLOTTE })).resolves.toEqual({
      fleetId: FLEET_ID,
      requestId: 'req_1',
      subject: ORDERBOT,
      requesters: [CHARLOTTE],
      askedAt: ASKED_AT,
      expiresAt: new Date('2026-10-27T09:00:00.000Z'),
      state: 'pending',
      decidedBy: null,
      decidedAt: null,
    });
  });

  it('joins the one pending for the same client, adding the second requester once', async () => {
    await openRequest()({ fleetId: FLEET_ID, subject: ORDERBOT, requester: CHARLOTTE });
    now = new Date('2026-10-21T09:00:00.000Z');

    await openRequest()({ fleetId: FLEET_ID, subject: ORDERBOT, requester: PIETER });
    const joined = await openRequest()({ fleetId: FLEET_ID, subject: ORDERBOT, requester: PIETER });

    expect({ requestId: joined.requestId, requesters: joined.requesters, expiresAt: joined.expiresAt, held: requests.held.length }).toEqual({
      requestId: 'req_1',
      requesters: [CHARLOTTE, PIETER],
      expiresAt: new Date('2026-10-27T09:00:00.000Z'),
      held: 1,
    });
  });

  it('keeps a request per client or server, and per fleet', async () => {
    await openRequest()({ fleetId: FLEET_ID, subject: ORDERBOT, requester: CHARLOTTE });
    await openRequest()({ fleetId: FLEET_ID, subject: LINEAR, requester: CHARLOTTE });
    await openRequest()({ fleetId: OTHER_FLEET_ID, subject: ORDERBOT, requester: CHARLOTTE });

    expect(requests.held.map(({ requestId, fleetId, subject }) => ({ requestId, fleetId, kind: subject.kind }))).toEqual([
      { requestId: 'req_1', fleetId: FLEET_ID, kind: 'client' },
      { requestId: 'req_2', fleetId: FLEET_ID, kind: 'server' },
      { requestId: 'req_3', fleetId: OTHER_FLEET_ID, kind: 'client' },
    ]);
  });

  it('opens a new request once the pending one expired at 7 days, and the old one reads expired', async () => {
    await openRequest()({ fleetId: FLEET_ID, subject: ORDERBOT, requester: CHARLOTTE });
    now = new Date('2026-10-27T09:00:00.000Z');

    const asked = await openRequest()({ fleetId: FLEET_ID, subject: ORDERBOT, requester: PIETER });

    expect({ requestId: asked.requestId, states: requests.held.map((request) => request.state) }).toEqual({ requestId: 'req_2', states: ['expired', 'pending'] });
  });

  it('joins it still just before 7 days', async () => {
    await openRequest()({ fleetId: FLEET_ID, subject: ORDERBOT, requester: CHARLOTTE });
    now = new Date('2026-10-27T08:59:59.999Z');

    await expect(openRequest()({ fleetId: FLEET_ID, subject: ORDERBOT, requester: PIETER })).resolves.toMatchObject({ requestId: 'req_1' });
  });
});
