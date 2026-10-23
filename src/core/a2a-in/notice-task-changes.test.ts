import { beforeEach, describe, expect, it } from 'vitest';

import { fakePushEvents, memoryPushStore } from '../../../test/support/a2a-push-fakes.js';
import { callsWithATask, TASK_ID, TASK_SENT_AT } from '../../../test/support/a2a-task-fakes.js';
import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aCallReply, MESSAGE_ID } from '../../../test/support/mcp-in-fakes.js';
import { createNoticeTaskChanges } from './notice-task-changes.js';
import type { PushConfig } from './ports.js';

const SUPPLIER = { fleetId: FLEET_ID, party: 'supplier' };
const NOW = new Date('2026-10-23T12:01:00.000Z');
const SUBMITTED_MARK = `submitted:${String(TASK_SENT_AT.getTime())}:1`;

let store: ReturnType<typeof memoryPushStore>;
let calls: Awaited<ReturnType<typeof callsWithATask>>;

const aConfig = (overrides: Partial<PushConfig> = {}): PushConfig => ({ ...SUPPLIER, taskId: TASK_ID, id: 'hook-1', url: 'https://hooks.supplier.example/a2a', token: null, authentication: null, createdAt: TASK_SENT_AT, noticedMark: SUBMITTED_MARK, isFollowing: true, ...overrides });

beforeEach(async () => {
  store = memoryPushStore();
  calls = await callsWithATask(SUPPLIER);
  await store.save(aConfig());
});

const notice = () => createNoticeTaskChanges({ calls, configs: store, events: fakePushEvents, clock: { now: () => NOW } })(SUPPLIER);
const pending = () => store.pushes.map((push) => ({ body: push.body, nextAt: push.nextAt }));

describe("the changes of a task with a push config become pushes to its webhook (slice 4)", () => {
  it('makes no push while the task has not changed since it was last noticed', async () => {
    await notice();

    expect(store.pushes).toEqual([]);
  });

  it('makes a push of its new status, due now, and notices the change once', async () => {
    await calls.setDelivery({ fleetId: FLEET_ID, messageId: MESSAGE_ID }, { state: 'acknowledged', since: NOW });

    await notice();
    await notice();

    expect(pending()).toEqual([{ body: 'status:working', nextAt: NOW }]);
  });

  it('makes a push of the artifact, then of the status, once it completes, and follows it no more', async () => {
    await calls.addReply({ fleetId: FLEET_ID, messageId: MESSAGE_ID }, aCallReply({ receivedAt: NOW }));

    await notice();

    expect({ pushes: pending().map((push) => push.body), isFollowing: store.configs[0]?.isFollowing }).toEqual({ pushes: [`artifact:${TASK_ID}`, 'status:completed'], isFollowing: false });
  });

  it("notices no config of another party's", async () => {
    await store.save(aConfig({ party: 'claude' }));
    await calls.setDelivery({ fleetId: FLEET_ID, messageId: MESSAGE_ID }, { state: 'acknowledged', since: NOW });

    await createNoticeTaskChanges({ calls, configs: store, events: fakePushEvents, clock: { now: () => NOW } })({ fleetId: FLEET_ID, party: 'claude' });

    expect(store.pushes).toEqual([]);
  });
});
