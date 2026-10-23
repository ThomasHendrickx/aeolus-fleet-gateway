import type { ClientCalls } from '../mcp-in/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { A2aCaller } from './authenticate-a2a-client.js';
import type { PushConfigs } from './ports.js';

export type RemovePushConfig = (input: { caller: A2aCaller; taskId: string; id: string }) => Promise<Result<undefined, DomainError<'TASK_NOT_FOUND'>>>;

/** Use case: an outside A2A client removes a push config of one of its own tasks (DeleteTaskPushNotificationConfig, slice 4), and the pushes still to make for it. Removing one no longer there succeeds, so a delete sent again does. */
export function createRemovePushConfig(deps: { calls: Pick<ClientCalls, 'findTask'>; configs: Pick<PushConfigs, 'remove'> }): RemovePushConfig {
  return async ({ caller, taskId, id }) => {
    if ((await deps.calls.findTask(caller, taskId)) === undefined) {
      return refuse('TASK_NOT_FOUND', `No task ${taskId}`);
    }
    await deps.configs.remove(caller, { taskId, id });
    return ok(undefined);
  };
}
