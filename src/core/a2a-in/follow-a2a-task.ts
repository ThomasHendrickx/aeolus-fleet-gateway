/**
 * Use case: follow an outside A2A client's task as it changes (slice 3,
 * interop 3.4), for a stream. It yields the task as it stands first, then
 * the task each time its state, or the replies it holds, change, read from
 * the call store, where the worker keeps each reply as it comes. It ends
 * when the task ends, when the task can no longer be read, or when its
 * signal is aborted (the client dropped the stream). Nothing is lost while
 * no stream follows: a new follow yields the task as it stands.
 */
import type { ClientCalls } from '../mcp-in/ports.js';
import type { Sleep } from '../mcp-out/run-party.js';
import type { Clock } from '../shared/clock.js';
import type { A2aCaller } from './authenticate-a2a-client.js';
import { isTerminal, taskViewOf, type TaskView } from './task-view.js';

export type FollowA2aTask = (input: { caller: A2aCaller; taskId: string; signal: AbortSignal }) => AsyncGenerator<TaskView, void, undefined>;

/** What tells one view of the task from the next: its state, since when, and how much history it holds. */
const markOf = (view: TaskView) => `${view.status.state}:${String(view.status.since.getTime())}:${String(view.history.length)}`;

export function createFollowA2aTask(deps: { calls: Pick<ClientCalls, 'findTask'>; clock: Clock; sleep: Sleep; pollMs: number }): FollowA2aTask {
  return async function* follow({ caller, taskId, signal }) {
    let yielded: string | undefined;
    while (!signal.aborted) {
      const task = await deps.calls.findTask(caller, taskId);
      if (task === undefined) {
        return;
      }
      const view = taskViewOf(task, deps.clock.now());
      const mark = markOf(view);
      if (mark !== yielded) {
        yielded = mark;
        yield view;
      }
      if (isTerminal(view)) {
        return;
      }
      await deps.sleep(deps.pollMs, signal);
    }
  };
}
