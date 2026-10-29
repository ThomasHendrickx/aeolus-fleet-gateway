/**
 * The ports of pushing an outside A2A client's task to its webhook (slice 4):
 * where its push configs and the pushes still to make are kept, how a
 * webhook's host resolves, how a push is POSTed, and how a task's change is
 * written as the A2A events the webhook gets.
 */
import type { FleetId } from '@aeolus-fleet/common';

import type { Result } from '../shared/result.js';
import type { TaskView } from './task-view.js';

/** What the webhook is called with besides its URL: the config's token, and its authentication, kept in the vault. */
export interface WebhookCredentials {
  token: string | null;
  authentication: { scheme: string; credentials: string } | null;
}

/** A push config of an outside A2A client's task (TaskPushNotificationConfig): where and how each change of the task is pushed. */
export interface PushConfig extends WebhookCredentials {
  fleetId: FleetId;
  party: string;
  taskId: string;
  id: string;
  url: string;
  createdAt: Date;
  /** The task as last noticed, as `markOf` tells it; changes are pushed from there. */
  noticedMark: string;
  /** Whether the task is still followed: once it ended, nothing more is noticed. */
  isFollowing: boolean;
}

interface Caller { fleetId: FleetId; party: string }
interface ConfigKey { taskId: string; id: string }

export interface PushConfigs {
  /** Keeps the config, in place of one of the same task and id. */
  save(config: PushConfig): Promise<void>;
  find(caller: Caller, key: ConfigKey): Promise<PushConfig | undefined>;
  /** The task's configs, oldest first, at most the limit after the cursor; the cursor of the next page, none at the end. */
  list(caller: Caller, page: { taskId: string; limit: number; after?: string }): Promise<{ configs: PushConfig[]; next: string | null }>;
  /** Removes the config and the pushes still to make for it: whether there was one. */
  remove(caller: Caller, key: ConfigKey): Promise<boolean>;
  /** The party's configs whose task is still followed. */
  following(caller: Caller): Promise<PushConfig[]>;
  /** In one unit of work: the change noticed on the config, and a push still to make for each event, in order. */
  notice(caller: Caller, change: ConfigKey & { mark: string; isFollowing: boolean; events: string[]; at: Date }): Promise<void>;
}

/** A push still to make: one event of a config's task, POSTed to its webhook. */
export interface Push {
  pushId: string;
  config: PushConfig;
  /** The event as the webhook gets it: A2A JSON. */
  body: string;
  /** How many times it was POSTed already. */
  attempts: number;
}

export interface Pushes {
  /** The party's pushes due now: per config, its oldest still to make, once its time came; at most the limit. */
  due(caller: Caller, page: { now: Date; limit: number }): Promise<Push[]>;
  delivered(caller: Caller, push: { pushId: string; attempts: number; at: Date }): Promise<void>;
  /** Another attempt at the time given, after the attempts made. */
  again(caller: Caller, push: { pushId: string; attempts: number; at: Date }): Promise<void>;
  /** No attempt more, with why. */
  givenUp(caller: Caller, push: { pushId: string; attempts: number; reason: string; at: Date }): Promise<void>;
}

export interface HostResolver {
  /** The addresses a host resolves to; none when it does not resolve. */
  addressesOf(host: string): Promise<string[]>;
}

/** Why a POST got no answer: the host resolved to an address the webhook is not reached at, or nothing answered. */
export type PostFailure = { kind: 'ADDRESS_REFUSED' } | { kind: 'UNREACHABLE'; message: string };

export interface WebhookPoster {
  /** POSTs the body as JSON to the URL with the credentials, connecting only to a public address: the HTTP status it answered. */
  post(url: string, push: { body: string } & WebhookCredentials): Promise<Result<{ status: number }, PostFailure>>;
}

export interface PushEvents {
  /** The events a webhook gets for the task as it stands now, as A2A JSON: a new artifact first, then the status. */
  eventsOf(view: TaskView): string[];
}

export interface PushConfigIds {
  newId(): string;
}
