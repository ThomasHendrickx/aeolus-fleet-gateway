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
    delivery: null,
    task: null,
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

  it('keeps a call with no deadline, as its capability stated none (interop 3.4)', async () => {
    const calls = createPrismaClientCalls(prisma);
    await calls.save(aCall({ messageId: 'msg_01m3tbfspe96yf1rnr4ank9m09', handle: 'handle-9', deadlineAt: null }));

    await expect(calls.findByHandle({ fleetId: FLEET, party: 'claude' }, 'handle-9')).resolves.toMatchObject({ deadlineAt: null });
  });

  it("reads the party's calls whose answer may still come: none past its deadline, another party's or another fleet's", async () => {
    const calls = createPrismaClientCalls(prisma);
    const now = new Date('2026-10-19T12:05:00.000Z');
    await calls.save(aCall({ messageId: 'msg_01m3tbfspe96yf1rnr4ank9w01', handle: 'w-1', party: 'zed' }));
    await calls.save(aCall({ messageId: 'msg_01m3tbfspe96yf1rnr4ank9w02', handle: 'w-2', party: 'zed', deadlineAt: null }));
    await calls.save(aCall({ messageId: 'msg_01m3tbfspe96yf1rnr4ank9w03', handle: 'w-3', party: 'zed', deadlineAt: now }));
    await calls.save(aCall({ messageId: 'msg_01m3tbfspe96yf1rnr4ank9w04', handle: 'w-4', party: 'cursor' }));
    await calls.save(aCall({ messageId: 'msg_01m3tbfspe96yf1rnr4ank9w05', handle: 'w-5', party: 'zed', fleetId: OTHER_FLEET }));

    const waited = await calls.waitedOn({ fleetId: FLEET, party: 'zed' }, now);

    expect(waited.map(({ messageId }) => messageId)).toEqual(['msg_01m3tbfspe96yf1rnr4ank9w01', 'msg_01m3tbfspe96yf1rnr4ank9w02']);
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

describe("outside A2A clients' tasks in Postgres (decision 0060)", () => {
  const SUPPLIER = { fleetId: FLEET, party: 'supplier' };
  const aTaskCall = (n: number, taskId: string, overrides: Partial<ClientCall> = {}) =>
    aCall({ party: 'supplier', messageId: `msg_01m3tbfspe96yf1rnr4ank9t${String(n).padStart(2, '0')}`, handle: `t-${String(n)}`, capability: null, outputContentType: null, deadlineAt: null, task: { taskId, message: `{"messageId":"m-${String(n)}"}` }, ...overrides });

  it("keeps where a call's delivery stands, read back with the call", async () => {
    const calls = createPrismaClientCalls(prisma);
    await calls.save(aCall({ messageId: 'msg_01m3tbfspe96yf1rnr4ank9d01', handle: 'd-1' }));
    await calls.setDelivery({ fleetId: FLEET, messageId: 'msg_01m3tbfspe96yf1rnr4ank9d01' }, { state: 'acknowledged', since: new Date('2026-10-19T12:00:30.000Z') });

    await expect(calls.findByMessage(FLEET, 'msg_01m3tbfspe96yf1rnr4ank9d01')).resolves.toMatchObject({ delivery: { state: 'acknowledged', since: new Date('2026-10-19T12:00:30.000Z') } });
  });

  it('reads a task with its context and its calls in the order sent; none of another party', async () => {
    const calls = createPrismaClientCalls(prisma);
    await calls.saveTask({ ...SUPPLIER, taskId: 'task-a', contextId: 'ctx-a', createdAt: new Date('2026-10-19T12:00:00.000Z') });
    await calls.save(aTaskCall(1, 'task-a'));
    await calls.save(aTaskCall(2, 'task-a', { sentAt: new Date('2026-10-19T12:02:00.000Z') }));

    const [own, other] = await Promise.all([calls.findTask(SUPPLIER, 'task-a'), calls.findTask({ fleetId: FLEET, party: 'claude' }, 'task-a')]);

    expect({ contextId: own?.contextId, messages: own?.calls.map((call) => call.task?.message), other }).toEqual({ contextId: 'ctx-a', messages: ['{"messageId":"m-1"}', '{"messageId":"m-2"}'], other: undefined });
  });

  it("lists the party's tasks newest first, a page at a time, in one context or all", async () => {
    const calls = createPrismaClientCalls(prisma);
    const lister = { fleetId: FLEET, party: 'lister' };
    for (const [n, context] of [[11, 'ctx-1'], [12, 'ctx-2'], [13, 'ctx-1']] as const) {
      await calls.saveTask({ ...lister, taskId: `task-${String(n)}`, contextId: context, createdAt: new Date(`2026-10-19T12:${String(n)}:00.000Z`) });
      await calls.save(aTaskCall(n, `task-${String(n)}`, { party: 'lister' }));
    }

    const first = await calls.listTasks(lister, { limit: 2 });
    const second = await calls.listTasks(lister, { limit: 2, after: first.next ?? '' });
    const inContext = await calls.listTasks(lister, { limit: 10, contextId: 'ctx-1' });

    expect({
      first: first.tasks.map((task) => task.taskId),
      second: second.tasks.map((task) => task.taskId),
      end: second.next,
      inContext: inContext.tasks.map((task) => task.taskId),
      callsKept: first.tasks[0]?.calls.length,
    }).toEqual({ first: ['task-13', 'task-12'], second: ['task-11'], end: null, inContext: ['task-13', 'task-11'], callsKept: 1 });
  });
});
