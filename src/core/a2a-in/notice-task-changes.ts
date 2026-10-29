/**
 * Use case: the changes of an outside A2A client's tasks become pushes to
 * their webhooks (slice 4). For each of the party's push configs whose task
 * is still followed, the task is read as it stands; once it changed since
 * last noticed, its events are kept as pushes still to make, due now, with
 * the change noticed in the same unit of work, so no change is pushed twice
 * nor lost on a restart. A task that ended is followed no more.
 */
import type { ClientCalls } from '../mcp-in/ports.js';
import type { Clock } from '../shared/clock.js';
import type { A2aCaller } from './authenticate-a2a-client.js';
import type { PushConfigs, PushEvents } from './ports.js';
import { isTerminal, markOf, taskViewOf } from './task-view.js';

export type NoticeTaskChanges = (caller: A2aCaller) => Promise<void>;

export function createNoticeTaskChanges(deps: { calls: Pick<ClientCalls, 'findTask'>; configs: Pick<PushConfigs, 'following' | 'notice'>; events: PushEvents; clock: Clock }): NoticeTaskChanges {
  return async (caller) => {
    for (const config of await deps.configs.following(caller)) {
      const task = await deps.calls.findTask(caller, config.taskId);
      const now = deps.clock.now();
      const view = task === undefined ? undefined : taskViewOf(task, now);
      if (view === undefined) {
        await deps.configs.notice(caller, { taskId: config.taskId, id: config.id, mark: config.noticedMark, isFollowing: false, events: [], at: now });
      } else if (markOf(view) !== config.noticedMark) {
        await deps.configs.notice(caller, { taskId: config.taskId, id: config.id, mark: markOf(view), isFollowing: !isTerminal(view), events: deps.events.eventsOf(view), at: now });
      }
    }
  };
}
