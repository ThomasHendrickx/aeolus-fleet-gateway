import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aClientCall, memoryClientCalls } from '../../../test/support/mcp-in-fakes.js';
import { createListA2aTasks } from './list-a2a-tasks.js';
import { createReadA2aTask } from './read-a2a-task.js';

const NOW = new Date('2026-10-23T12:05:00.000Z');
const SUPPLIER = { fleetId: FLEET_ID, party: 'supplier' };

let calls: ReturnType<typeof memoryClientCalls>;

beforeEach(async () => {
  calls = memoryClientCalls();
  for (const [n, contextId] of [[1, 'ctx-1'], [2, 'ctx-2'], [3, 'ctx-1']] as const) {
    await calls.saveTask({ ...SUPPLIER, taskId: `task-${String(n)}`, contextId, createdAt: new Date(`2026-10-23T12:0${String(n)}:00.000Z`) });
    await calls.save(aClientCall({ party: 'supplier', messageId: `msg_01m3tbfspe96yf1rnr4ank9m0${String(n)}`, handle: `task-${String(n)}`, deadlineAt: null, task: { taskId: `task-${String(n)}`, message: '{}' } }));
  }
});

describe('GetTask reads one of the caller’s own tasks (decision 0060)', () => {
  const read = () => createReadA2aTask({ calls, clock: { now: () => NOW } });

  it('answers the task as it stands', async () => {
    await expect(read()(SUPPLIER, 'task-2')).resolves.toMatchObject({ isOk: true, value: { taskId: 'task-2', contextId: 'ctx-2', status: { state: 'submitted' } } });
  });

  it("refuses another party's task as not found", async () => {
    await expect(read()({ fleetId: FLEET_ID, party: 'claude' }, 'task-2')).resolves.toMatchObject({ isOk: false, error: { kind: 'TASK_NOT_FOUND' } });
  });
});

describe('ListTasks lists only the caller’s own tasks (decision 0060)', () => {
  const list = () => createListA2aTasks({ calls, clock: { now: () => NOW } });

  it('lists them newest first, a page at a time', async () => {
    const first = await list()(SUPPLIER, { pageSize: 2 });
    const second = await list()(SUPPLIER, { pageSize: 2, pageToken: first.next ?? '' });

    expect({ first: first.tasks.map((task) => task.taskId), second: second.tasks.map((task) => task.taskId), end: second.next }).toEqual({ first: ['task-3', 'task-2'], second: ['task-1'], end: null });
  });

  it('lists one context', async () => {
    expect((await list()(SUPPLIER, { contextId: 'ctx-1' })).tasks.map((task) => task.taskId)).toEqual(['task-3', 'task-1']);
  });

  it("lists none of another party's", async () => {
    expect((await list()({ fleetId: FLEET_ID, party: 'claude' }, {})).tasks).toEqual([]);
  });

  it('takes a page of at most 100, and 50 when the caller names none', async () => {
    const asked: number[] = [];
    const counting = { ...calls, listTasks: (caller: typeof SUPPLIER, page: { limit: number }) => {
        asked.push(page.limit);
        return calls.listTasks(caller, page);
      },
    };

    await createListA2aTasks({ calls: counting, clock: { now: () => NOW } })(SUPPLIER, { pageSize: 1000 });
    await createListA2aTasks({ calls: counting, clock: { now: () => NOW } })(SUPPLIER, {});

    expect(asked).toEqual([100, 50]);
  });
});
