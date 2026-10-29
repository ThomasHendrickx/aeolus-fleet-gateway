import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaOutcomeNotices } from '../src/adapters/prisma/outcome-notices.js';
import { createPrismaPendingRequests } from '../src/adapters/prisma/pending-requests.js';
import type { OutcomeNotice, PendingRequest } from '../src/core/requests/ports.js';
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

  it('lists the requests an account asked or joined, in its fleet only, the newest first', async () => {
    const requests = createPrismaPendingRequests(prisma);
    const fleet: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8x2';
    const older = aRequest({ fleetId: fleet, askedAt: new Date('2026-10-20T08:00:00.000Z'), requesters: [{ accountId: 'acc-mine', personShipId: null }] });
    const joined = aRequest({ fleetId: fleet, requesters: [{ accountId: 'acc-pieter', personShipId: null }] });
    const pieters = aRequest({ fleetId: fleet, requesters: [{ accountId: 'acc-pieter', personShipId: null }] });
    const otherFleet = aRequest({ fleetId: OTHER_FLEET, requesters: [{ accountId: 'acc-mine', personShipId: null }] });
    for (const request of [older, joined, pieters, otherFleet]) {
      await requests.open({ ...request, now: ASKED_AT });
    }
    await requests.open({ ...joined, requestId: 'req_01m5c7hmbt9f1vrkwb37azjoin', requesters: [{ accountId: 'acc-mine', personShipId: null }], now: ASKED_AT });

    await expect(requests.listMine(fleet, 'acc-mine').then((listed) => listed.map((request) => request.requestId))).resolves.toEqual([joined.requestId, older.requestId]);
  });

  it('lets one of two approvers claim a request at once, and the first decision count', async () => {
    const requests = createPrismaPendingRequests(prisma);
    const request = aRequest();
    await requests.open({ ...request, now: ASKED_AT });

    const claims = await Promise.all([requests.claim(FLEET, { requestId: request.requestId, now: AFTER }), requests.claim(FLEET, { requestId: request.requestId, now: AFTER })]);
    const decisions = await Promise.all([
      requests.decide(FLEET, { requestId: request.requestId, from: ['approving'], decision: { outcome: 'approved', decidedBy: { kind: 'ship', shipId: OWNER }, decidedAt: AFTER }, notices: [] }),
      requests.decide(FLEET, { requestId: request.requestId, from: ['pending'], decision: { outcome: 'denied', decidedBy: { kind: 'operator' }, decidedAt: AFTER }, notices: [] }),
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
    await requests.decide(FLEET, { requestId: first.requestId, from: ['pending'], decision: { outcome: 'denied', decidedBy: { kind: 'operator' }, decidedAt: AFTER }, notices: [] });
    const second = { ...aRequest(), subject, askedAt: AFTER };
    await requests.open({ ...second, now: AFTER });
    await requests.decide(FLEET, { requestId: second.requestId, from: ['pending'], decision: { outcome: 'denied', decidedBy: { kind: 'operator' }, decidedAt: AFTER }, notices: [] });

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

  it('writes the outcomes to tell with the decision, and lists each until it is ended', async () => {
    const requests = createPrismaPendingRequests(prisma);
    const notices = createPrismaOutcomeNotices(prisma);
    const request = aRequest({ subject: { kind: 'server', url: `https://server-${String(sequence)}.example.com/mcp` } });
    await requests.open({ ...request, now: ASKED_AT });
    const notice: OutcomeNotice = { fleetId: FLEET, requestId: request.requestId, accountId: 'acc-charlotte', personShipId: OWNER, url: 'https://mcp.linear.app/mcp', outcome: 'approved', partyName: 'linear' };

    const isDecided = await requests.decide(FLEET, { requestId: request.requestId, from: ['pending'], decision: { outcome: 'approved', decidedBy: { kind: 'operator' }, decidedAt: AFTER }, notices: [notice] });
    const listed = (await notices.listUnended(100)).filter(({ requestId }) => requestId === request.requestId);
    await notices.end(notice);

    expect({ isDecided, listed, afterEnd: (await notices.listUnended(100)).filter(({ requestId }) => requestId === request.requestId) }).toEqual({ isDecided: true, listed: [notice], afterEnd: [] });
  });

  it('writes no outcome for a decision that did not count', async () => {
    const requests = createPrismaPendingRequests(prisma);
    const request = aRequest();
    await requests.open({ ...request, now: ASKED_AT });
    await requests.decide(FLEET, { requestId: request.requestId, from: ['pending'], decision: { outcome: 'denied', decidedBy: { kind: 'operator' }, decidedAt: AFTER }, notices: [] });
    const late: OutcomeNotice = { fleetId: FLEET, requestId: request.requestId, accountId: 'acc-charlotte', personShipId: OWNER, url: 'https://x.example.com/mcp', outcome: 'approved', partyName: 'x' };

    await expect(requests.decide(FLEET, { requestId: request.requestId, from: ['pending'], decision: { outcome: 'approved', decidedBy: { kind: 'operator' }, decidedAt: AFTER }, notices: [late] })).resolves.toBe(false);
    expect((await createPrismaOutcomeNotices(prisma).listUnended(100)).filter(({ requestId }) => requestId === request.requestId)).toEqual([]);
  });

  it('lists the pending requests due by now in every fleet, and expires each once, with its outcomes to tell', async () => {
    const requests = createPrismaPendingRequests(prisma);
    const due = aRequest({ fleetId: OTHER_FLEET, expiresAt: new Date('2026-09-01T09:00:00.000Z'), askedAt: new Date('2026-08-25T09:00:00.000Z') });
    await requests.open({ ...due, now: new Date('2026-08-25T09:00:00.000Z') });
    const now = new Date('2026-09-01T09:00:00.000Z');
    const notice: OutcomeNotice = { fleetId: OTHER_FLEET, requestId: due.requestId, accountId: 'acc-charlotte', personShipId: OWNER, url: 'https://x.example.com/mcp', outcome: 'expired', partyName: null };

    const listed = (await requests.listDue(now)).map(({ requestId }) => requestId);
    const expired = [await requests.expire(OTHER_FLEET, { requestId: due.requestId, now, notices: [notice] }), await requests.expire(OTHER_FLEET, { requestId: due.requestId, now, notices: [notice] })];

    expect({ listed, expired, state: (await requests.find(OTHER_FLEET, due.requestId))?.state, notices: (await createPrismaOutcomeNotices(prisma).listUnended(100)).filter(({ requestId }) => requestId === due.requestId) }).toEqual({
      listed: [due.requestId],
      expired: [true, false],
      state: 'expired',
      notices: [notice],
    });
  });

  it('forgets a fleet with its requests and their outcomes to tell (decision 0021)', async () => {
    const requests = createPrismaPendingRequests(prisma);
    const request = aRequest({ fleetId: OTHER_FLEET });
    await requests.open({ ...request, now: ASKED_AT });
    const notice: OutcomeNotice = { fleetId: OTHER_FLEET, requestId: request.requestId, accountId: 'acc-charlotte', personShipId: OWNER, url: 'https://x.example.com/mcp', outcome: 'denied', partyName: null };
    await requests.decide(OTHER_FLEET, { requestId: request.requestId, from: ['pending'], decision: { outcome: 'denied', decidedBy: { kind: 'operator' }, decidedAt: AFTER }, notices: [notice] });

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    await expect(requests.find(OTHER_FLEET, request.requestId)).resolves.toBeUndefined();
    expect((await createPrismaOutcomeNotices(prisma).listUnended(100)).filter(({ fleetId }) => fleetId === OTHER_FLEET)).toEqual([]);
  });
});
