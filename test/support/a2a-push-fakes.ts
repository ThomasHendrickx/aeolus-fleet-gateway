/**
 * In-memory stand-ins for the ports of pushing an A2A client's task to its
 * webhook (slice 4): one store for the configs and their pushes, a resolver
 * and a poster that answer as told, and events that name the state pushed.
 */
import type { FleetId } from '@aeolus-fleet/common';

import type { HostResolver, Push, PushConfig, PushConfigIds, PushConfigs, PushEvents, Pushes, WebhookCredentials, WebhookPoster, PostFailure } from '../../src/core/a2a-in/ports.js';
import { err, ok, type Result } from '../../src/core/shared/result.js';

interface Caller { fleetId: FleetId; party: string }

interface HeldPush {
  pushId: string;
  fleetId: FleetId;
  party: string;
  taskId: string;
  configId: string;
  body: string;
  attempts: number;
  nextAt: Date;
  state: 'pending' | 'delivered' | 'givenUp';
  reason?: string;
}

const isOf = (caller: Caller, held: { fleetId: FleetId; party: string }) => held.fleetId === caller.fleetId && held.party === caller.party;

/** The configs and their pushes in memory, as the database keeps them. */
export function memoryPushStore(): PushConfigs & Pushes & { configs: PushConfig[]; pushes: HeldPush[] } {
  const configs: PushConfig[] = [];
  const pushes: HeldPush[] = [];
  let drawn = 0;
  const findIndex = (caller: Caller, key: { taskId: string; id: string }) => configs.findIndex((config) => isOf(caller, config) && config.taskId === key.taskId && config.id === key.id);
  const update = (pushId: string, change: Partial<HeldPush>) => {
    const at = pushes.findIndex((push) => push.pushId === pushId);
    const held = pushes[at];
    if (held !== undefined) {
      pushes[at] = { ...held, ...change };
    }
  };
  return {
    configs,
    pushes,
    save: (config) => {
      const at = findIndex(config, config);
      if (at < 0) {
        configs.push(config);
      } else {
        configs[at] = config;
      }
      return Promise.resolve();
    },
    find: (caller, key) => Promise.resolve(configs[findIndex(caller, key)]),
    list: (caller, page) => {
      const ofTask = configs.filter((config) => isOf(caller, config) && config.taskId === page.taskId);
      const from = page.after === undefined ? 0 : ofTask.findIndex((config) => config.id === page.after) + 1;
      const listed = ofTask.slice(from, from + page.limit);
      const hasMore = from + page.limit < ofTask.length;
      return Promise.resolve({ configs: listed, next: hasMore ? (listed.at(-1)?.id ?? null) : null });
    },
    remove: (caller, key) => {
      const at = findIndex(caller, key);
      if (at < 0) {
        return Promise.resolve(false);
      }
      configs.splice(at, 1);
      for (let index = pushes.length - 1; index >= 0; index -= 1) {
        const push = pushes[index];
        if (push !== undefined && isOf(caller, push) && push.taskId === key.taskId && push.configId === key.id) {
          pushes.splice(index, 1);
        }
      }
      return Promise.resolve(true);
    },
    following: (caller) => Promise.resolve(configs.filter((config) => isOf(caller, config) && config.isFollowing)),
    notice: (caller, change) => {
      const at = findIndex(caller, change);
      const config = configs[at];
      if (config !== undefined) {
        configs[at] = { ...config, noticedMark: change.mark, isFollowing: change.isFollowing };
        for (const body of change.events) {
          drawn += 1;
          pushes.push({ pushId: `push-${String(drawn)}`, ...caller, taskId: change.taskId, configId: change.id, body, attempts: 0, nextAt: change.at, state: 'pending' });
        }
      }
      return Promise.resolve();
    },
    due: (caller, page) => {
      const due: Push[] = [];
      for (const config of configs.filter((each) => isOf(caller, each))) {
        const oldest = pushes.find((push) => isOf(caller, push) && push.taskId === config.taskId && push.configId === config.id && push.state === 'pending');
        if (oldest !== undefined && oldest.nextAt.getTime() <= page.now.getTime()) {
          due.push({ pushId: oldest.pushId, config, body: oldest.body, attempts: oldest.attempts });
        }
      }
      return Promise.resolve(due.slice(0, page.limit));
    },
    delivered: (_caller, { pushId, attempts }) => {
      update(pushId, { state: 'delivered', attempts });
      return Promise.resolve();
    },
    again: (_caller, { pushId, attempts, at }) => {
      update(pushId, { attempts, nextAt: at });
      return Promise.resolve();
    },
    givenUp: (_caller, { pushId, attempts, reason }) => {
      update(pushId, { state: 'givenUp', attempts, reason });
      return Promise.resolve();
    },
  };
}

/** Hosts resolving as told; any other resolves to nothing. */
export function fakeResolver(hosts: Record<string, string[]>): HostResolver {
  return { addressesOf: (host) => Promise.resolve(hosts[host] ?? []) };
}

/** A poster answering each POST in turn as told, the last answer again once they ran out; each POST kept. */
export function fakePoster(answers: Result<{ status: number }, PostFailure>[]): WebhookPoster & { posted: ({ url: string; body: string } & WebhookCredentials)[] } {
  const posted: ({ url: string; body: string } & WebhookCredentials)[] = [];
  return {
    posted,
    post: (url, push) => {
      posted.push({ url, ...push });
      return Promise.resolve(answers[Math.min(posted.length - 1, answers.length - 1)] ?? err({ kind: 'UNREACHABLE', message: 'no answer' }));
    },
  };
}

export const answered = (status: number) => ok({ status });

/** Events naming the state of the task pushed, and a completed task's artifact before its status. */
export const fakePushEvents: PushEvents = {
  eventsOf: (view) => (view.status.state === 'completed' ? [`artifact:${view.taskId}`, `status:${view.status.state}`] : [`status:${view.status.state}`]),
};

export function fakeConfigIds(): PushConfigIds {
  let drawn = 0;
  return {
    newId: () => {
      drawn += 1;
      return `config-${String(drawn)}`;
    },
  };
}
