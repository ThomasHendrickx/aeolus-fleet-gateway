import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaAgentCalls } from '../src/adapters/prisma/agent-calls.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import type { AgentCall } from '../src/core/a2a-out/ports.js';
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

function aCall(overrides: Partial<AgentCall> = {}): AgentCall {
  return {
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9d01',
    fleetId: FLEET,
    party: 'supplier',
    messageId: 'msg_01m3tbfspe96yf1rnr4ank9m01',
    senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9agt',
    state: 'sending',
    taskId: null,
    contextId: null,
    deadlineAt: new Date('2026-10-23T13:00:00.000Z'),
    ...overrides,
  };
}

describe("the gateway's messages to outside A2A agents in Postgres (slice 6)", () => {
  it('keeps a call, and each step after it, read back by a new client as after a restart', async () => {
    const calls = createPrismaAgentCalls(prisma);
    await calls.save(aCall());
    await calls.save(aCall({ state: 'following', taskId: 'task-1', contextId: 'ctx-1' }));

    await expect(createPrismaAgentCalls(prisma).find({ fleetId: FLEET, party: 'supplier' }, 'dlv_01m3tbfspe96yf1rnr4ank9d01')).resolves.toEqual(aCall({ state: 'following', taskId: 'task-1', contextId: 'ctx-1' }));
  });

  it("finds and keeps a call in the party's own fleet only", async () => {
    const calls = createPrismaAgentCalls(prisma);
    const deliveryId = 'dlv_01m3tbfspe96yf1rnr4ank9g01';
    await calls.save(aCall({ deliveryId, state: 'following', taskId: 'task-own', contextId: 'ctx-own' }));
    await calls.save(aCall({ deliveryId, fleetId: OTHER_FLEET, state: 'done', taskId: 'task-other', contextId: 'ctx-other' }));

    const found = await Promise.all([calls.find({ fleetId: FLEET, party: 'supplier' }, deliveryId), calls.find({ fleetId: OTHER_FLEET, party: 'supplier' }, deliveryId), calls.find({ fleetId: FLEET, party: 'another' }, deliveryId)]);

    expect(found.map((call) => call?.taskId)).toEqual(['task-own', 'task-other', undefined]);
  });

  it("lists the party's calls still followed, in its own fleet only", async () => {
    const calls = createPrismaAgentCalls(prisma);
    await calls.save(aCall({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9e01', state: 'following', taskId: 'task-a', contextId: 'ctx-a' }));
    await calls.save(aCall({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9e02', state: 'done', taskId: 'task-b', contextId: 'ctx-b' }));
    await calls.save(aCall({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9e03', fleetId: OTHER_FLEET, state: 'following', taskId: 'task-c', contextId: 'ctx-c' }));
    await calls.save(aCall({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9e04', party: 'another', state: 'following', taskId: 'task-d', contextId: 'ctx-d' }));

    const followed = await calls.following({ fleetId: FLEET, party: 'supplier' });

    expect(followed.map(({ taskId }) => taskId).filter((taskId) => taskId !== 'task-1')).toEqual(['task-a']);
  });

  it("names the task a reply tells of, by the reply's message id, in the party's own fleet only", async () => {
    const calls = createPrismaAgentCalls(prisma);
    await calls.saveReply({ fleetId: FLEET, party: 'supplier' }, { messageId: 'msg_01m3tbfspe96yf1rnr4ank9r01', taskId: 'task-1', contextId: 'ctx-1' });
    await calls.saveReply({ fleetId: FLEET, party: 'supplier' }, { messageId: 'msg_01m3tbfspe96yf1rnr4ank9r01', taskId: 'task-1', contextId: 'ctx-1' });

    await expect(
      Promise.all([
        calls.taskOfReply({ fleetId: FLEET, party: 'supplier' }, 'msg_01m3tbfspe96yf1rnr4ank9r01'),
        calls.taskOfReply({ fleetId: OTHER_FLEET, party: 'supplier' }, 'msg_01m3tbfspe96yf1rnr4ank9r01'),
        calls.taskOfReply({ fleetId: FLEET, party: 'another' }, 'msg_01m3tbfspe96yf1rnr4ank9r01'),
      ]),
    ).resolves.toEqual([{ taskId: 'task-1', contextId: 'ctx-1' }, undefined, undefined]);
  });

  it('forgets them with the fleet (decision 0021)', async () => {
    const calls = createPrismaAgentCalls(prisma);
    await calls.save(aCall({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9f01', fleetId: OTHER_FLEET, state: 'following', taskId: 'task-z', contextId: 'ctx-z' }));
    await calls.saveReply({ fleetId: OTHER_FLEET, party: 'supplier' }, { messageId: 'msg_01m3tbfspe96yf1rnr4ank9r09', taskId: 'task-z', contextId: 'ctx-z' });

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    await expect(Promise.all([calls.find({ fleetId: OTHER_FLEET, party: 'supplier' }, 'dlv_01m3tbfspe96yf1rnr4ank9f01'), calls.taskOfReply({ fleetId: OTHER_FLEET, party: 'supplier' }, 'msg_01m3tbfspe96yf1rnr4ank9r09')])).resolves.toEqual([undefined, undefined]);
  });
});
