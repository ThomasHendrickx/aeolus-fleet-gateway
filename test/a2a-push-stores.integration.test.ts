import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaPushStore } from '../src/adapters/prisma/push-store.js';
import type { PushConfig } from '../src/core/a2a-in/ports.js';
import { migratedDatabase } from './support/database.js';

// An A2A client's push configs and the pushes still to make (slice 4), in
// Postgres: kept over a restart, each config's in order, and all of a fleet
// forgotten with it.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const SUPPLIER = { fleetId: FLEET, party: 'supplier' };
const AT = new Date('2026-10-23T12:00:00.000Z');
const LATER = new Date('2026-10-23T12:05:00.000Z');

let prisma: PrismaClient;
let databaseUrl: string;

beforeAll(async () => {
  databaseUrl = await migratedDatabase(inject('postgresUrl'));
  prisma = createPrismaClient(databaseUrl);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.a2aPush.deleteMany();
  await prisma.a2aPushConfig.deleteMany();
});

const aConfig = (overrides: Partial<PushConfig> = {}): PushConfig => ({ ...SUPPLIER, taskId: 'task-1', id: 'hook-1', url: 'https://hooks.supplier.example/a2a', token: 'tok-1', authentication: { scheme: 'Bearer', credentials: 'secret-1' }, createdAt: AT, noticedMark: 'm0', isFollowing: true, ...overrides });

describe("an A2A client's push configs in Postgres (slice 4)", () => {
  it('keeps a config with its credentials, one per task and id, the latest set', async () => {
    const store = createPrismaPushStore(prisma);
    await store.save(aConfig({ token: 'old' }));
    await store.save(aConfig({ token: 'new' }));

    await expect(store.find(SUPPLIER, { taskId: 'task-1', id: 'hook-1' })).resolves.toEqual(aConfig({ token: 'new' }));
    await expect(store.find({ fleetId: FLEET, party: 'claude' }, { taskId: 'task-1', id: 'hook-1' })).resolves.toBeUndefined();
  });

  it("lists a task's configs a page at a time, oldest first", async () => {
    const store = createPrismaPushStore(prisma);
    for (const [n, id] of ['hook-a', 'hook-b', 'hook-c'].entries()) {
      await store.save(aConfig({ id, createdAt: new Date(AT.getTime() + n) }));
    }

    const first = await store.list(SUPPLIER, { taskId: 'task-1', limit: 2 });
    const second = await store.list(SUPPLIER, { taskId: 'task-1', limit: 2, after: first.next ?? '' });

    expect({ first: first.configs.map((config) => config.id), second: second.configs.map((config) => config.id), end: second.next }).toEqual({ first: ['hook-a', 'hook-b'], second: ['hook-c'], end: null });
  });

  it('notices a change and keeps its pushes in one go, follows a task no more once told, and removes a config with its pushes', async () => {
    const store = createPrismaPushStore(prisma);
    await store.save(aConfig());
    await store.save(aConfig({ id: 'hook-2' }));

    await store.notice(SUPPLIER, { taskId: 'task-1', id: 'hook-1', mark: 'm1', isFollowing: false, events: ['{"a":1}', '{"b":2}'], at: AT });
    const following = await store.following(SUPPLIER);
    const isRemoved = await store.remove(SUPPLIER, { taskId: 'task-1', id: 'hook-1' });

    expect({ following: following.map((config) => config.id), isRemoved, pushes: await prisma.a2aPush.count(), isRemovedAgain: await store.remove(SUPPLIER, { taskId: 'task-1', id: 'hook-1' }) }).toEqual({ following: ['hook-2'], isRemoved: true, pushes: 0, isRemovedAgain: false });
  });
});

describe('the pushes still to make in Postgres (slice 4)', () => {
  it("answers per config its oldest push still to make, once due, kept over a restart", async () => {
    const store = createPrismaPushStore(prisma);
    await store.save(aConfig());
    await store.save(aConfig({ id: 'hook-2' }));
    await store.notice(SUPPLIER, { taskId: 'task-1', id: 'hook-1', mark: 'm1', isFollowing: true, events: ['{"n":1}', '{"n":2}'], at: AT });
    await store.notice(SUPPLIER, { taskId: 'task-1', id: 'hook-2', mark: 'm1', isFollowing: true, events: ['{"n":3}'], at: LATER });

    const restarted = createPrismaClient(databaseUrl);
    const due = await createPrismaPushStore(restarted).due(SUPPLIER, { now: AT, limit: 10 });
    await restarted.$disconnect();

    expect(due.map((push) => ({ body: push.body, config: push.config.id, attempts: push.attempts, token: push.config.token }))).toEqual([{ body: '{"n":1}', config: 'hook-1', attempts: 0, token: 'tok-1' }]);
  });

  it('answers the next push once the first is delivered or given up, and none while the first waits to be tried again', async () => {
    const store = createPrismaPushStore(prisma);
    await store.save(aConfig());
    await store.notice(SUPPLIER, { taskId: 'task-1', id: 'hook-1', mark: 'm1', isFollowing: true, events: ['{"n":1}', '{"n":2}', '{"n":3}'], at: AT });
    const [first] = await store.due(SUPPLIER, { now: AT, limit: 10 });

    await store.again(SUPPLIER, { pushId: first?.pushId ?? '', attempts: 1, at: LATER });
    const whileWaiting = await store.due(SUPPLIER, { now: AT, limit: 10 });
    await store.delivered(SUPPLIER, { pushId: first?.pushId ?? '', attempts: 2, at: LATER });
    const [second] = await store.due(SUPPLIER, { now: LATER, limit: 10 });
    await store.givenUp(SUPPLIER, { pushId: second?.pushId ?? '', attempts: 1, reason: 'The webhook answered 404', at: LATER });
    const [third] = await store.due(SUPPLIER, { now: LATER, limit: 10 });

    expect({ whileWaiting, second: second?.body, third: third?.body }).toEqual({ whileWaiting: [], second: '{"n":2}', third: '{"n":3}' });
  });

  it("answers none of another party's, nor of another fleet's", async () => {
    const store = createPrismaPushStore(prisma);
    await store.save(aConfig());
    await store.notice(SUPPLIER, { taskId: 'task-1', id: 'hook-1', mark: 'm1', isFollowing: true, events: ['{"n":1}'], at: AT });

    await expect(Promise.all([store.due({ fleetId: FLEET, party: 'claude' }, { now: LATER, limit: 10 }), store.due({ fleetId: OTHER_FLEET, party: 'supplier' }, { now: LATER, limit: 10 })])).resolves.toEqual([[], []]);
  });

  it('forgets a fleet with its configs and pushes', async () => {
    const store = createPrismaPushStore(prisma);
    await store.save(aConfig());
    await store.notice(SUPPLIER, { taskId: 'task-1', id: 'hook-1', mark: 'm1', isFollowing: true, events: ['{"n":1}'], at: AT });

    await createPrismaFleetForgetter(prisma).forget(FLEET);

    expect([await prisma.a2aPushConfig.count(), await prisma.a2aPush.count()]).toEqual([0, 0]);
  });
});
