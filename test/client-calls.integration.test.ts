import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaClientCalls } from '../src/adapters/prisma/client-calls.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import type { ClientCall } from '../src/core/mcp-in/ports.js';
import { migratedDatabase } from './support/database.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

function aCall(overrides: Partial<ClientCall> = {}): ClientCall {
  return {
    fleetId: FLEET,
    party: 'claude',
    messageId: 'msg_01m3tbfspe96yf1rnr4ank9m01',
    handle: 'handle-1',
    shipId: 'shp_01m3tbfspe96yf1rnr4ank9cr2',
    capability: 'list_deals',
    sentAt: new Date('2026-10-19T12:00:00.000Z'),
    ...overrides,
  };
}

describe("outside clients' calls in Postgres", () => {
  it('keeps a call, read back by its handle within its fleet and party', async () => {
    const calls = createPrismaClientCalls(prisma);
    await calls.save(aCall());

    await expect(Promise.all([calls.findByHandle(FLEET, 'claude', 'handle-1'), calls.findByHandle(FLEET, 'cursor', 'handle-1'), calls.findByHandle(OTHER_FLEET, 'claude', 'handle-1')])).resolves.toEqual([aCall(), undefined, undefined]);
  });

  it('keeps one call per message: the same send again changes nothing', async () => {
    const calls = createPrismaClientCalls(prisma);
    const call = aCall({ messageId: 'msg_01m3tbfspe96yf1rnr4ank9m02', handle: 'handle-2' });
    await calls.save(call);
    await calls.save({ ...call, sentAt: new Date('2026-10-19T13:00:00.000Z') });

    await expect(calls.findByHandle(FLEET, 'claude', 'handle-2')).resolves.toEqual(call);
  });

  it('forgets a fleet with its calls (decision 0021)', async () => {
    const calls = createPrismaClientCalls(prisma);
    await calls.save(aCall({ fleetId: OTHER_FLEET, handle: 'handle-o' }));

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    await expect(calls.findByHandle(OTHER_FLEET, 'claude', 'handle-o')).resolves.toBeUndefined();
  });
});
