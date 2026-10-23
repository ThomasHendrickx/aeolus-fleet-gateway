import type { ClientCalls } from '../mcp-in/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { A2aCaller } from './authenticate-a2a-client.js';
import type { PushConfigs } from './ports.js';
import { pushConfigViewOf, type PushConfigView } from './push-config-view.js';

export type ReadPushConfig = (input: { caller: A2aCaller; taskId: string; id: string }) => Promise<Result<PushConfigView, DomainError<'TASK_NOT_FOUND' | 'PUSH_CONFIG_NOT_FOUND'>>>;

/** Use case: an outside A2A client reads a push config of one of its own tasks (GetTaskPushNotificationConfig, slice 4), without its credentials. */
export function createReadPushConfig(deps: { calls: Pick<ClientCalls, 'findTask'>; configs: Pick<PushConfigs, 'find'> }): ReadPushConfig {
  return async ({ caller, taskId, id }) => {
    if ((await deps.calls.findTask(caller, taskId)) === undefined) {
      return refuse('TASK_NOT_FOUND', `No task ${taskId}`);
    }
    const config = await deps.configs.find(caller, { taskId, id });
    return config === undefined ? refuse('PUSH_CONFIG_NOT_FOUND', `No push config ${id} on the task ${taskId}`) : ok(pushConfigViewOf(config));
  };
}
