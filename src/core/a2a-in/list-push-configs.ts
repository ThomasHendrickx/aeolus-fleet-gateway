import type { ClientCalls } from '../mcp-in/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { A2aCaller } from './authenticate-a2a-client.js';
import type { PushConfigs } from './ports.js';
import { pushConfigViewOf, type PushConfigView } from './push-config-view.js';

/** The most configs a page holds, and how many when the client names no size. */
const PAGE_MAX = 100;
const PAGE_DEFAULT = 50;

export type ListPushConfigs = (input: { caller: A2aCaller; taskId: string; pageSize?: number; pageToken?: string }) => Promise<Result<{ configs: PushConfigView[]; next: string | null }, DomainError<'TASK_NOT_FOUND'>>>;

/** Use case: an outside A2A client lists the push configs of one of its own tasks (ListTaskPushNotificationConfigs, slice 4), a page at a time, without their credentials. */
export function createListPushConfigs(deps: { calls: Pick<ClientCalls, 'findTask'>; configs: Pick<PushConfigs, 'list'> }): ListPushConfigs {
  return async ({ caller, taskId, pageSize, pageToken }) => {
    if ((await deps.calls.findTask(caller, taskId)) === undefined) {
      return refuse('TASK_NOT_FOUND', `No task ${taskId}`);
    }
    const limit = pageSize === undefined || pageSize <= 0 ? PAGE_DEFAULT : Math.min(pageSize, PAGE_MAX);
    const page = await deps.configs.list(caller, { taskId, limit, ...(pageToken === undefined || pageToken === '' ? {} : { after: pageToken }) });
    return ok({ configs: page.configs.map(pushConfigViewOf), next: page.next });
  };
}
