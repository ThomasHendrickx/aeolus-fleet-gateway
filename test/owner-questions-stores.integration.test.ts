import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaOwnerQuestions } from '../src/adapters/prisma/owner-questions.js';
import { createPrismaPendingRequests } from '../src/adapters/prisma/pending-requests.js';
import type { PendingRequest } from '../src/core/requests/ports.js';
import { migratedDatabase } from './support/database.js';

// The gateway's questions to its owner in Postgres (decision 0056): one per
// request, asked while the request is open, withdrawn once it ended.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const OWNER: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8pp';
const ASKED_AT = new Date('2026-10-20T09:00:00.000Z');
const NOW = new Date('2026-10-21T09:00:00.000Z');

let prisma: PrismaClient;
let sequence = 0;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** A new open request for its own client, so tests share no rows. */
async function anOpenRequest(overrides: Partial<PendingRequest> = {}): Promise<PendingRequest> {
  sequence += 1;
  const number = String(sequence).padStart(4, '0');
  const request: PendingRequest = {
    fleetId: FLEET,
    requestId: `req_01m5cjq0000000000000qq${number}`,
    subject: { kind: 'client', clientId: `https://client-${number}.example.com/client.json`, clientName: `Client ${number}` },
    requesters: [{ accountId: 'acc-charlotte', personShipId: null }],
    askedAt: ASKED_AT,
    expiresAt: new Date('2026-10-27T09:00:00.000Z'),
    state: 'pending',
    decidedBy: null,
    decidedAt: null,
    ...overrides,
  };
  await createPrismaPendingRequests(prisma).open({ ...request, now: ASKED_AT });
  return request;
}

const ids = (listed: { requestId: string }[] | { request: { requestId: string } }[]) => listed.map((each) => ('request' in each ? each.request.requestId : each.requestId));

describe("the gateway's questions to its owner in Postgres", () => {
  it('lists an open request to ask until it is asked, keeping its first question id', async () => {
    const questions = createPrismaOwnerQuestions(prisma);
    const request = await anOpenRequest();

    const before = ids(await questions.listToAsk(NOW, 1000));
    const kept = [await questions.keep(FLEET, { requestId: request.requestId, questionId: '0b5f3c1e-7d4a-4c2b-9f1e-2a6d8c4b1e01' }), await questions.keep(FLEET, { requestId: request.requestId, questionId: '0b5f3c1e-7d4a-4c2b-9f1e-2a6d8c4b1e02' })];
    const kept1 = (await questions.listToAsk(NOW, 1000)).find((each) => each.request.requestId === request.requestId)?.questionId;
    await questions.markAsked(FLEET, { requestId: request.requestId, askedShipId: OWNER, at: NOW });

    expect({ isListedBefore: before.includes(request.requestId), kept, kept1, isListedAfter: ids(await questions.listToAsk(NOW, 1000)).includes(request.requestId) }).toEqual({
      isListedBefore: true,
      kept: ['0b5f3c1e-7d4a-4c2b-9f1e-2a6d8c4b1e01', '0b5f3c1e-7d4a-4c2b-9f1e-2a6d8c4b1e01'],
      kept1: '0b5f3c1e-7d4a-4c2b-9f1e-2a6d8c4b1e01',
      isListedAfter: false,
    });
  });

  it('lists no request to ask once it expired by now', async () => {
    const request = await anOpenRequest({ expiresAt: NOW });

    expect(ids(await createPrismaOwnerQuestions(prisma).listToAsk(NOW, 1000))).not.toContain(request.requestId);
  });

  it('lists an asked question to withdraw once its request is decided or expired, until it is withdrawn', async () => {
    const questions = createPrismaOwnerQuestions(prisma);
    const decided = await anOpenRequest();
    const expiring = await anOpenRequest({ expiresAt: new Date('2026-10-22T09:00:00.000Z') });
    const open = await anOpenRequest();
    for (const { requestId } of [decided, expiring, open]) {
      await questions.keep(FLEET, { requestId, questionId: `0b5f3c1e-7d4a-4c2b-9f1e-2a6d8c4b${requestId.slice(-4)}` });
      await questions.markAsked(FLEET, { requestId, askedShipId: OWNER, at: NOW });
    }
    await createPrismaPendingRequests(prisma).decide(FLEET, { requestId: decided.requestId, from: ['pending'], decision: { outcome: 'denied', decidedBy: { kind: 'operator' }, decidedAt: NOW }, notices: [] });
    const later = new Date('2026-10-22T09:00:00.000Z');

    const toWithdraw = ids(await questions.listToWithdraw(later, 1000)).filter((id) => [decided, expiring, open].some((each) => each.requestId === id));
    await questions.markWithdrawn(FLEET, { requestId: decided.requestId, at: later });

    expect({ toWithdraw, after: ids(await questions.listToWithdraw(later, 1000)).filter((id) => [decided, expiring, open].some((each) => each.requestId === id)) }).toEqual({
      toWithdraw: [decided.requestId, expiring.requestId],
      after: [expiring.requestId],
    });
  });

  it('forgets a fleet with its questions (decision 0021)', async () => {
    const questions = createPrismaOwnerQuestions(prisma);
    const request = await anOpenRequest({ fleetId: OTHER_FLEET });
    await questions.keep(OTHER_FLEET, { requestId: request.requestId, questionId: '0b5f3c1e-7d4a-4c2b-9f1e-2a6d8c4b1e99' });
    await questions.markAsked(OTHER_FLEET, { requestId: request.requestId, askedShipId: OWNER, at: NOW });

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    expect(ids(await questions.listToWithdraw(new Date('2027-01-01T00:00:00.000Z'), 1000))).not.toContain(request.requestId);
  });
});
