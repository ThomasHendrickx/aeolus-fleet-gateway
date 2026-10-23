import type { ClientCalls } from '../mcp-in/ports.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { A2aCaller } from './authenticate-a2a-client.js';
import { taskViewOf, type TaskView } from './task-view.js';

export type ReadA2aTask = (caller: A2aCaller, taskId: string) => Promise<Result<TaskView, DomainError<'TASK_NOT_FOUND'>>>;

/** Use case: an outside A2A client reads one of its own tasks as it stands (GetTask); another party's is not found. */
export function createReadA2aTask(deps: { calls: Pick<ClientCalls, 'findTask'>; clock: Clock }): ReadA2aTask {
  return async (caller, taskId) => {
    const task = await deps.calls.findTask(caller, taskId);
    return task === undefined ? refuse('TASK_NOT_FOUND', `No task ${taskId}`) : ok(taskViewOf(task, deps.clock.now()));
  };
}
