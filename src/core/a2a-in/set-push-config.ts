/**
 * Use case: an outside A2A client sets a push config on one of its own tasks
 * (CreateTaskPushNotificationConfig, slice 4). Its webhook is an https URL
 * reached only at public addresses, as its host resolves now. The config is
 * kept with its token and authentication, in place of one of the same id,
 * and the task is followed from as it stands: the changes after it are
 * pushed. The client is answered the config without its credentials.
 */
import type { ClientCalls } from '../mcp-in/ports.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { A2aCaller } from './authenticate-a2a-client.js';
import type { HostResolver, PushConfigIds, PushConfigs, WebhookCredentials } from './ports.js';
import { pushConfigViewOf, type PushConfigView } from './push-config-view.js';
import { isTerminal, markOf, taskViewOf } from './task-view.js';
import { isReachedOnlyInPublic } from './webhook-address.js';
import { webhookUrlOf } from './webhook.js';

export type SetPushConfig = (input: { caller: A2aCaller; config: { taskId: string; id?: string; url: string } & WebhookCredentials }) => Promise<Result<PushConfigView, DomainError<'TASK_NOT_FOUND' | 'WEBHOOK_REFUSED'>>>;

export function createSetPushConfig(deps: { calls: Pick<ClientCalls, 'findTask'>; configs: Pick<PushConfigs, 'save'>; resolver: HostResolver; ids: PushConfigIds; clock: Clock }): SetPushConfig {
  return async ({ caller, config }) => {
    const task = await deps.calls.findTask(caller, config.taskId);
    if (task === undefined) {
      return refuse('TASK_NOT_FOUND', `No task ${config.taskId}`);
    }
    const url = webhookUrlOf(config.url);
    if (!url.isOk) {
      return url;
    }
    if (!(await isReachedOnlyInPublic(deps.resolver, url.value))) {
      return refuse('WEBHOOK_REFUSED', 'The webhook must resolve to public addresses only');
    }
    const now = deps.clock.now();
    const view = taskViewOf(task, now);
    const kept = { ...caller, taskId: config.taskId, id: config.id ?? deps.ids.newId(), url: config.url, token: config.token, authentication: config.authentication, createdAt: now, noticedMark: markOf(view), isFollowing: !isTerminal(view) };
    await deps.configs.save(kept);
    return ok(pushConfigViewOf(kept));
  };
}
