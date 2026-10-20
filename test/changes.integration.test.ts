import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { listenToChanges, type Change } from '../src/adapters/prisma/changes.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaPendingRequests } from '../src/adapters/prisma/pending-requests.js';
import type { PendingRequest } from '../src/core/requests/ports.js';
import { migratedDatabase } from './support/database.js';
import { aNewDatabaseUrl } from './support/fleet-server.js';

// What the pages' live channel hears from Postgres: each committed change to
// a fleet's pending requests, on every gateway instance listening, and a call
// to read everything anew when the listening connection was lost.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OWNER: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8pp';
const NOW = new Date('2026-10-20T09:00:00.000Z');
const HEARD_WITHIN_MS = 5000;
const SILENCE_MS = 500;

let databaseUrl: string;
let prisma: PrismaClient;
let sequence = 0;
let heard: Change[];
let resyncs: number;
let listening: { close(): Promise<void> };

beforeAll(async () => {
  databaseUrl = await migratedDatabase(inject('postgresUrl'));
  prisma = createPrismaClient(databaseUrl);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  heard = [];
  resyncs = 0;
  listening = await listenToChanges(databaseUrl, {
    onChange: (change) => heard.push(change),
    onResync: () => {
      resyncs += 1;
    },
  });
});

afterEach(async () => {
  await listening.close();
});

function aRequest(): PendingRequest {
  sequence += 1;
  const number = String(sequence).padStart(4, '0');
  return {
    fleetId: FLEET,
    requestId: `req_01m5c7hmbt9f1vrkwb37az${number}`,
    subject: { kind: 'client', clientId: `https://client-${number}.example.com/client.json`, clientName: `Client ${number}` },
    requesters: [{ accountId: 'acc-charlotte', personShipId: OWNER }],
    askedAt: NOW,
    expiresAt: new Date('2026-10-27T09:00:00.000Z'),
    state: 'pending',
    decidedBy: null,
    decidedAt: null,
  };
}

async function until(isDone: () => boolean): Promise<void> {
  const deadline = Date.now() + HEARD_WITHIN_MS;
  while (!isDone()) {
    if (Date.now() > deadline) {
      throw new Error('not heard in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("the changes to a fleet's pending requests, heard by the pages", () => {
  it('hears a request opened, naming its fleet', async () => {
    await createPrismaPendingRequests(prisma).open({ ...aRequest(), now: NOW });

    await until(() => heard.length > 0);
    expect(heard).toEqual([{ fleetId: FLEET, topic: 'requests' }]);
  });

  it('hears a request decided', async () => {
    const requests = createPrismaPendingRequests(prisma);
    const request = await requests.open({ ...aRequest(), now: NOW });
    await until(() => heard.length > 0);
    heard = [];

    await requests.decide(FLEET, { requestId: request.requestId, from: ['pending'], decision: { outcome: 'denied', decidedBy: { kind: 'operator' }, decidedAt: NOW } });

    await until(() => heard.length > 0);
    expect(heard).toEqual([{ fleetId: FLEET, topic: 'requests' }]);
  });

  it('never hears a change rolled back', async () => {
    await expect(
      prisma.$transaction(async (transaction) => {
        await createPrismaPendingRequests(transaction).open({ ...aRequest(), now: NOW });
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');

    await new Promise((resolve) => setTimeout(resolve, SILENCE_MS));
    expect(heard).toEqual([]);
  });

  it('asks to read everything anew once the lost connection is back, and hears changes again', async () => {
    await prisma.$executeRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'aeolus-gateway-changes' AND datname = current_database()`;

    await until(() => resyncs > 0);
    await createPrismaPendingRequests(prisma).open({ ...aRequest(), now: NOW });
    await until(() => heard.length > 0);
    expect(heard).toEqual([{ fleetId: FLEET, topic: 'requests' }]);
  });

  it('starts while the database does not answer, without failing', async () => {
    const waiting = await listenToChanges(aNewDatabaseUrl(inject('postgresUrl'), 'never_created'), { onChange: () => undefined, onResync: () => undefined });

    await expect(waiting.close()).resolves.toBeUndefined();
  });
});
