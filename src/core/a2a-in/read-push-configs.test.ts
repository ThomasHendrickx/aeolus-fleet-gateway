import { beforeEach, describe, expect, it } from 'vitest';

import { memoryPushStore } from '../../../test/support/a2a-push-fakes.js';
import { callsWithATask, TASK_ID } from '../../../test/support/a2a-task-fakes.js';
import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import type { PushConfig } from './ports.js';
import { createListPushConfigs } from './list-push-configs.js';
import { createReadPushConfig } from './read-push-config.js';
import { createRemovePushConfig } from './remove-push-config.js';

const SUPPLIER = { fleetId: FLEET_ID, party: 'supplier' };
const OTHER = { fleetId: FLEET_ID, party: 'claude' };
const AT = new Date('2026-10-23T12:01:00.000Z');

let store: ReturnType<typeof memoryPushStore>;
let calls: Awaited<ReturnType<typeof callsWithATask>>;

const aConfig = (id: string): PushConfig => ({ ...SUPPLIER, taskId: TASK_ID, id, url: `https://hooks.supplier.example/${id}`, token: 'tok', authentication: { scheme: 'Bearer', credentials: 'secret' }, createdAt: AT, noticedMark: 'm', isFollowing: true });

beforeEach(async () => {
  store = memoryPushStore();
  calls = await callsWithATask(SUPPLIER);
  for (const id of ['hook-1', 'hook-2', 'hook-3']) {
    await store.save(aConfig(id));
  }
});

describe("GetTaskPushNotificationConfig reads one of the caller's own (slice 4)", () => {
  const read = () => createReadPushConfig({ calls, configs: store });

  it('answers it without its token or authentication', async () => {
    await expect(read()({ caller: SUPPLIER, taskId: TASK_ID, id: 'hook-2' })).resolves.toEqual({ isOk: true, value: { taskId: TASK_ID, id: 'hook-2', url: 'https://hooks.supplier.example/hook-2' } });
  });

  it("refuses another party's task as not found, and an unknown config", async () => {
    const [others, unknown] = [await read()({ caller: OTHER, taskId: TASK_ID, id: 'hook-2' }), await read()({ caller: SUPPLIER, taskId: TASK_ID, id: 'hook-9' })];

    expect([others, unknown]).toMatchObject([
      { isOk: false, error: { kind: 'TASK_NOT_FOUND' } },
      { isOk: false, error: { kind: 'PUSH_CONFIG_NOT_FOUND' } },
    ]);
  });
});

describe("ListTaskPushNotificationConfigs lists the caller's own (slice 4)", () => {
  const list = () => createListPushConfigs({ calls, configs: store });

  it('lists them a page at a time, without their token or authentication', async () => {
    const first = await list()({ caller: SUPPLIER, taskId: TASK_ID, pageSize: 2 });
    const second = first.isOk ? await list()({ caller: SUPPLIER, taskId: TASK_ID, pageSize: 2, pageToken: first.value.next ?? '' }) : first;

    expect([first, second]).toEqual([
      { isOk: true, value: { configs: [{ taskId: TASK_ID, id: 'hook-1', url: 'https://hooks.supplier.example/hook-1' }, { taskId: TASK_ID, id: 'hook-2', url: 'https://hooks.supplier.example/hook-2' }], next: 'hook-2' } },
      { isOk: true, value: { configs: [{ taskId: TASK_ID, id: 'hook-3', url: 'https://hooks.supplier.example/hook-3' }], next: null } },
    ]);
  });

  it("refuses another party's task as not found", async () => {
    await expect(list()({ caller: OTHER, taskId: TASK_ID })).resolves.toMatchObject({ isOk: false, error: { kind: 'TASK_NOT_FOUND' } });
  });
});

describe("DeleteTaskPushNotificationConfig removes one of the caller's own (slice 4)", () => {
  const remove = () => createRemovePushConfig({ calls, configs: store });

  it('removes it, with the pushes still to make for it', async () => {
    await store.notice(SUPPLIER, { taskId: TASK_ID, id: 'hook-2', mark: 'm2', isFollowing: true, events: ['status:working'], at: AT });

    await expect(remove()({ caller: SUPPLIER, taskId: TASK_ID, id: 'hook-2' })).resolves.toEqual({ isOk: true, value: undefined });
    expect({ configs: store.configs.map((config) => config.id), pushes: store.pushes }).toEqual({ configs: ['hook-1', 'hook-3'], pushes: [] });
  });

  it("refuses another party's task as not found, removing nothing", async () => {
    await expect(remove()({ caller: OTHER, taskId: TASK_ID, id: 'hook-2' })).resolves.toMatchObject({ isOk: false, error: { kind: 'TASK_NOT_FOUND' } });
    expect(store.configs).toHaveLength(3);
  });

  it('removes a config no longer there without error, as a delete again does', async () => {
    await remove()({ caller: SUPPLIER, taskId: TASK_ID, id: 'hook-2' });

    await expect(remove()({ caller: SUPPLIER, taskId: TASK_ID, id: 'hook-2' })).resolves.toEqual({ isOk: true, value: undefined });
  });
});
