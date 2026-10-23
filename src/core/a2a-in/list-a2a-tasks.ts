import type { ClientCalls } from '../mcp-in/ports.js';
import type { Clock } from '../shared/clock.js';
import type { A2aCaller } from './authenticate-a2a-client.js';
import { taskViewOf, type TaskView } from './task-view.js';

/** The most tasks a page holds, and how many when the caller names no size. */
const PAGE_SIZE_MAX = 100;
const PAGE_SIZE_DEFAULT = 50;

export type ListA2aTasks = (caller: A2aCaller, filter: { pageSize?: number; pageToken?: string; contextId?: string }) => Promise<{ tasks: TaskView[]; next: string | null; pageSize: number }>;

/** Use case: an outside A2A client lists its own tasks, newest first, a page at a time, in one context or all (ListTasks); never another party's. */
export function createListA2aTasks(deps: { calls: Pick<ClientCalls, 'listTasks'>; clock: Clock }): ListA2aTasks {
  return async (caller, { pageSize, pageToken, contextId }) => {
    const limit = Math.min(Math.max(pageSize ?? PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX);
    const page = await deps.calls.listTasks(caller, { limit, ...(pageToken === undefined || pageToken === '' ? {} : { after: pageToken }), ...(contextId === undefined || contextId === '' ? {} : { contextId }) });
    const now = deps.clock.now();
    return { tasks: page.tasks.map((task) => taskViewOf(task, now)), next: page.next, pageSize: limit };
  };
}
