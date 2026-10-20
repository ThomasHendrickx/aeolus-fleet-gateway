import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaPendingRequests } from '../src/adapters/prisma/pending-requests.js';
import type { PendingRequest } from '../src/core/requests/ports.js';
import { migratedDatabase } from './support/database.js';

// The gateway's pending requests in Postgres (decision 0056): one open
// request per client or server in a fleet, joined by a second requester, even
// when both ask at once; the first decision counts.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const OWNER: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8pp';
const ASKED_AT = new Date('2026-10-20T09:00:00.000Z');
const AFTER = new Date('2026-10-21T09:00:00.000Z');

let prisma: PrismaClient;
let sequence = 0;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** A new request for its own client, so tests share no rows. */
function aRequest(overrides: Partial<PendingRequest> = {}): PendingRequest {
  sequence += 1;
  const number = String(sequence).padStart(4, '0');
  return {
    fleetId: FLEET,
    requestId: `req_01m5c7hmbt9f1vrkwb37az${number}`,
    subject: { kind: 'client', clientId: `https://client-${number}.example.com/client.json`, clientName: `Client ${number}` },
    requesters: [{ accountId: 'acc-charlotte', personShipId: OWNER }],
    askedAt: ASKED_AT,
    expiresAt: new Date('2026-10-27T09:00:00.000Z'),
    state: 'pending',
    decidedBy: null,
    decidedAt: null,
    ...overrides,
  };
}

describe('pending requests in Postgres', () => {
  it('keeps a request, found in its fleet only', async () => {
    const requests = createPrismaPendingRequests(prisma);
    const request = aRequest();

    await expect(requests.open({ ...request, now: ASKED_AT })).resolves.toEqual(request);
    await expect(Promise.all([requests.find(FLEET, request.requestId), requests.find(OTHER_FLEET, request.requestId)])).resolves.toEqual([request, undefined]);
  });

  it('joins two requesters asking for the same client at once into one request', async () => {
    const requests = createPrismaPendingRequests(prisma);
    const first = aRequest();
    const second = { ...first, requestId: aRequest().requestId, requesters: [{ accountId: 'acc-pieter', personShipId: null }] };

    const opened = await Promise.all([requests.open({ ...first, now: ASKED_AT }), requests.open({ ...second, now: ASKED_AT })]);

    const ids = new Set(opened.map((request) => request.requestId));
    const kept = await requests.find(FLEET, [...ids][0] ?? '');
    expect({ ids: ids.size, requesters: kept?.requesters.map((requester) => requester.accountId).sort() }).toEqual({ ids: 1, requesters: ['acc-charlotte', 'acc-pieter'] });
  });

  it('opens a new request once the pending one expired, and keeps the old one as expired', async () => {
    const requests = createPrismaPendingRequests(prisma);
    const old = aRequest({ expiresAt: AFTER });
    await requests.open({ ...old, now: ASKED_AT });
    const fresh = { ...old, requestId: aRequest().requestId, askedAt: AFTER, expiresAt: new Date('2026-10-28T09:00:00.000Z') };

    await expect(requests.open({ ...fresh, now: AFTER })).resolves.toMatchObject({ requestId: fresh.requestId });
    await expect(requests.find(FLEET, old.requestId)).resolves.toMatchObject({ state: 'expired' });
  });

  it('lists the open requests of a fleet, unexpired, the oldest first', async () => {
    const requests = createPrismaPendingRequests(prisma);
    const fleet: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8x1';
    const older = aRequest({ fleetId: fleet, askedAt: new Date('2026-10-20T08:00:00.000Z') });
    const newer = aRequest({ fleetId: fleet });
    const expired = aRequest({ fleetId: fleet, expiresAt: AFTER });
    for (const request of [newer, older, expired]) {
      await requests.open({ ...request, now: ASKED_AT });
    }

    await expect(requests.listOpen(fleet, AFTER).then((listed) => listed.map((request) => request.requestId))).resolves.toEqual([older.requestId, newer.requestId]);
  });

  it('lets one of two approvers claim a request at once, and the first decision count', async () => {
    const requests = createPrismaPendingRequests(prisma);
    const request = aRequest();
    await requests.open({ ...request, now: ASKED_AT });

    const claims = await Promise.all([requests.claim(FLEET, { requestId: request.requestId, now: AFTER }), requests.claim(FLEET, { requestId: request.requestId, now: AFTER })]);
    const decisions = await Promise.all([
      requests.decide(FLEET, { requestId: request.requestId, from: ['approving'], decision: { outcome: 'approved', decidedBy: { kind: 'ship', shipId: OWNER }, decidedAt: AFTER } }),
      requests.decide(FLEET, { requestId: request.requestId, from: ['pending'], decision: { outcome: 'denied', decidedBy: { kind: 'operator' }, decidedAt: AFTER } }),
    ]);

    expect({ claims: claims.filter(Boolean).length, decisions }).toEqual({ claims: 1, decisions: [true, false] });
    await expect(requests.find(FLEET, request.requestId)).resolves.toMatchObject({ state: 'approved', decidedBy: { kind: 'ship', shipId: OWNER }, decidedAt: AFTER });
  });

  it('claims no expired request, and gives a released claim back as pending', async () => {
    const requests = createPrismaPendingRequests(prisma);
    const expired = aRequest({ expiresAt: AFTER });
    const released = aRequest();
    await requests.open({ ...expired, now: ASKED_AT });
    await requests.open({ ...released, now: ASKED_AT });
    await requests.claim(FLEET, { requestId: released.requestId, now: AFTER });

    await requests.release(FLEET, released.requestId);

    await expect(requests.claim(FLEET, { requestId: expired.requestId, now: AFTER })).resolves.toBe(false);
    await expect(requests.find(FLEET, released.requestId)).resolves.toMatchObject({ state: 'pending' });
  });

  it('finds the latest request an account asked for a client, in its fleet only, and whether the account was told its end', async () => {
    const requests = createPrismaPendingRequests(prisma);
    const first = aRequest();
    const subject = first.subject;
    await requests.open({ ...first, now: ASKED_AT });
    await requests.decide(FLEET, { requestId: first.requestId, from: ['pending'], decision: { outcome: 'denied', decidedBy: { kind: 'operator' }, decidedAt: AFTER } });
    const second = { ...aRequest(), subject, askedAt: AFTER };
    await requests.open({ ...second, now: AFTER });
    await requests.decide(FLEET, { requestId: second.requestId, from: ['pending'], decision: { outcome: 'denied', decidedBy: { kind: 'operator' }, decidedAt: AFTER } });

    await requests.markTold(FLEET, { requestId: second.requestId, accountId: 'acc-charlotte' });

    await expect(
      Promise.all([
        requests.latestAskedBy(FLEET, { subject, accountId: 'acc-charlotte' }),
        requests.latestAskedBy(FLEET, { subject, accountId: 'acc-pieter' }),
        requests.latestAskedBy(OTHER_FLEET, { subject, accountId: 'acc-charlotte' }),
      ]),
    ).resolves.toEqual([{ request: { ...second, state: 'denied', decidedBy: { kind: 'operator' }, decidedAt: AFTER }, isTold: true }, undefined, undefined]);
  });

  it('tells one requester only, so another is still to be told', async () => {
    const requests = createPrismaPendingRequests(prisma);
    const request = aRequest();
    await requests.open({ ...request, now: ASKED_AT });
    await requests.open({ ...request, requestId: `${request.requestId.slice(0, -4)}9999`, requesters: [{ accountId: 'acc-pieter', personShipId: null }], now: ASKED_AT });

    await requests.markTold(FLEET, { requestId: request.requestId, accountId: 'acc-pieter' });
    await requests.markTold(FLEET, { requestId: request.requestId, accountId: 'acc-pieter' });

    await expect(
      Promise.all([requests.latestAskedBy(FLEET, { subject: request.subject, accountId: 'acc-charlotte' }), requests.latestAskedBy(FLEET, { subject: request.subject, accountId: 'acc-pieter' })]).then((found) =>
        found.map((each) => each?.isTold),
      ),
    ).resolves.toEqual([false, true]);
  });

  it('forgets a fleet with its requests (decision 0021)', async () => {
    const requests = createPrismaPendingRequests(prisma);
    const request = aRequest({ fleetId: OTHER_FLEET });
    await requests.open({ ...request, now: ASKED_AT });

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    await expect(requests.find(OTHER_FLEET, request.requestId)).resolves.toBeUndefined();
  });
});
