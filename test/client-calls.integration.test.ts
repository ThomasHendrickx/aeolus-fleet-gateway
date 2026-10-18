import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaClientCalls } from '../src/adapters/prisma/client-calls.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import type { CallReply, ClientCall } from '../src/core/mcp-in/client-call.js';
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
    outputContentType: 'application/vnd.aeolus.mcp-result+json; name=list_deals',
    sentAt: new Date('2026-10-19T12:00:00.000Z'),
    deadlineAt: new Date('2026-10-19T12:10:00.000Z'),
    replies: [],
    ...overrides,
  };
}

describe("outside clients' calls in Postgres", () => {
  it('keeps a call, read back by its handle within its fleet and party', async () => {
    const calls = createPrismaClientCalls(prisma);
    await calls.save(aCall());

    await expect(Promise.all([calls.findByHandle({ fleetId: FLEET, party: 'claude' }, 'handle-1'), calls.findByHandle({ fleetId: FLEET, party: 'cursor' }, 'handle-1'), calls.findByHandle({ fleetId: OTHER_FLEET, party: 'claude' }, 'handle-1')])).resolves.toEqual([aCall(), undefined, undefined]);
  });

  it('keeps one call per message: the same send again changes nothing', async () => {
    const calls = createPrismaClientCalls(prisma);
    const call = aCall({ messageId: 'msg_01m3tbfspe96yf1rnr4ank9m02', handle: 'handle-2' });
    await calls.save(call);
    await calls.save({ ...call, sentAt: new Date('2026-10-19T13:00:00.000Z') });

    await expect(calls.findByHandle({ fleetId: FLEET, party: 'claude' }, 'handle-2')).resolves.toEqual(call);
  });

  it('keeps each reply on its call once, in the order kept, read back by handle and by message', async () => {
    const calls = createPrismaClientCalls(prisma);
    const call = aCall({ messageId: 'msg_01m3tbfspe96yf1rnr4ank9m03', handle: 'handle-3', outputContentType: null });
    const first: CallReply = { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9r01', messageId: 'msg_01m3tbfspe96yf1rnr4ank9r01', contentType: 'text/plain', payload: 'Looking.', receivedAt: new Date('2026-10-19T12:01:00.000Z') };
    const second: CallReply = { ...first, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9r02', messageId: 'msg_01m3tbfspe96yf1rnr4ank9r02', payload: 'Done.', receivedAt: new Date('2026-10-19T12:02:00.000Z') };
    await calls.save(call);
    await calls.addReply({ fleetId: FLEET, messageId: call.messageId }, second);
    await calls.addReply({ fleetId: FLEET, messageId: call.messageId }, first);
    await calls.addReply({ fleetId: FLEET, messageId: call.messageId }, second);

    const read = { ...call, replies: [second, first] };
    await expect(Promise.all([calls.findByHandle({ fleetId: FLEET, party: 'claude' }, 'handle-3'), calls.findByMessage(FLEET, call.messageId), calls.findByMessage(OTHER_FLEET, call.messageId)])).resolves.toEqual([read, read, undefined]);
  });

  it('forgets a fleet with its calls (decision 0021)', async () => {
    const calls = createPrismaClientCalls(prisma);
    await calls.save(aCall({ fleetId: OTHER_FLEET, handle: 'handle-o' }));

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    await expect(calls.findByHandle({ fleetId: OTHER_FLEET, party: 'claude' }, 'handle-o')).resolves.toBeUndefined();
  });
});
