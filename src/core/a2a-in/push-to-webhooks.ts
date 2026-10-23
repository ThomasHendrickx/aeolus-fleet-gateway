import type { Sleep } from '../mcp-out/run-party.js';
import type { A2aCaller } from './authenticate-a2a-client.js';
import type { DeliverPushes } from './deliver-pushes.js';
import type { NoticeTaskChanges } from './notice-task-changes.js';

export type PushToWebhooks = (input: { caller: A2aCaller; signal: AbortSignal }) => Promise<void>;

/** Use case: an outside A2A client's pushes, round after round until stopped (slice 4): its tasks' changes noticed, then the pushes due delivered. */
export function createPushToWebhooks(deps: { notice: NoticeTaskChanges; deliver: DeliverPushes; sleep: Sleep; pollMs: number }): PushToWebhooks {
  return async ({ caller, signal }) => {
    while (!signal.aborted) {
      await deps.notice(caller);
      await deps.deliver(caller);
      await deps.sleep(deps.pollMs, signal);
    }
  };
}
