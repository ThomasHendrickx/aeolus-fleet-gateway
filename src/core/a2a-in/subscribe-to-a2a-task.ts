import type { ClientCalls } from '../mcp-in/ports.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { A2aCaller } from './authenticate-a2a-client.js';
import type { FollowA2aTask } from './follow-a2a-task.js';
import { isTerminal, taskViewOf, type TaskView } from './task-view.js';

export type SubscribeToA2aTask = (input: { caller: A2aCaller; taskId: string; signal: AbortSignal }) => Promise<Result<AsyncIterable<TaskView>, DomainError<'TASK_NOT_FOUND' | 'TASK_TERMINAL'>>>;

/** Use case: an outside A2A client follows one of its own tasks still open (SubscribeToTask); another party's is not found, and an ended one is refused. */
export function createSubscribeToA2aTask(deps: { calls: Pick<ClientCalls, 'findTask'>; clock: Clock; follow: FollowA2aTask }): SubscribeToA2aTask {
  return async ({ caller, taskId, signal }) => {
    const task = await deps.calls.findTask(caller, taskId);
    if (task === undefined) {
      return refuse('TASK_NOT_FOUND', `No task ${taskId}`);
    }
    if (isTerminal(taskViewOf(task, deps.clock.now()))) {
      return refuse('TASK_TERMINAL', `The task ${taskId} has ended: read it with GetTask`);
    }
    return ok(deps.follow({ caller, taskId, signal }));
  };
}
