/**
 * An outside A2A client's push configs and the pushes still to make, in
 * Postgres (slice 4). A config is kept per fleet, task and id, its token and
 * authentication with it as the vault keeps credentials. A push's id is its
 * order: per config, only the oldest still pending is due, so a config's
 * pushes go in the order kept. Every query is scoped by fleet and party.
 */
import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { Push, PushConfig, PushConfigs, Pushes } from '../../core/a2a-in/ports.js';
import type { PrismaClient } from './client.js';
import { Prisma } from './generated/client.js';

const authenticationSchema = z.object({ scheme: z.string(), credentials: z.string() }).nullable();

interface ConfigRow {
  fleetId: string;
  taskId: string;
  id: string;
  party: string;
  url: string;
  token: string | null;
  authentication: unknown;
  createdAt: Date;
  noticedMark: string;
  isFollowing: boolean;
}

function configOf(row: ConfigRow): PushConfig {
  return {
    fleetId: idSchema('fleet').parse(row.fleetId),
    party: row.party,
    taskId: row.taskId,
    id: row.id,
    url: row.url,
    token: row.token,
    authentication: authenticationSchema.parse(row.authentication ?? null),
    createdAt: row.createdAt,
    noticedMark: row.noticedMark,
    isFollowing: row.isFollowing,
  };
}

/** Where a page of configs ends: the last config's time and id, as an opaque cursor. */
const cursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.string() });

function cursorOf(after: string): z.infer<typeof cursorSchema> | undefined {
  try {
    return cursorSchema.safeParse(JSON.parse(Buffer.from(after, 'base64url').toString('utf8'))).data;
  } catch {
    return undefined;
  }
}

const dueRowSchema = z.object({ pushId: z.number(), taskId: z.string(), configId: z.string(), body: z.string(), attempts: z.number() });

export function createPrismaPushStore(db: PrismaClient): PushConfigs & Pushes {
  /** One push as it ends or waits, its party's own only. */
  const settle = (caller: { fleetId: string; party: string }, push: { pushId: string; data: { state?: string; attempts: number; nextAt?: Date; reason?: string; settledAt?: Date } }) =>
    db.a2aPush.updateMany({ where: { pushId: Number(push.pushId), fleetId: caller.fleetId, party: caller.party }, data: push.data });

  return {
    save: async (config) => {
      const { fleetId, taskId, id, ...rest } = config;
      const data = { ...rest, authentication: config.authentication === null ? Prisma.DbNull : { ...config.authentication } };
      await db.a2aPushConfig.upsert({ where: { fleetId_taskId_id: { fleetId, taskId, id } }, create: { fleetId, taskId, id, ...data }, update: data });
    },
    find: async ({ fleetId, party }, { taskId, id }) => {
      const row = await db.a2aPushConfig.findFirst({ where: { fleetId, taskId, id, party } });
      return row === null ? undefined : configOf(row);
    },
    list: async ({ fleetId, party }, { taskId, limit, after }) => {
      const cursor = after === undefined ? undefined : cursorOf(after);
      if (after !== undefined && cursor === undefined) {
        return { configs: [], next: null };
      }
      const rows = await db.a2aPushConfig.findMany({
        where: { fleetId, party, taskId, ...(cursor === undefined ? {} : { OR: [{ createdAt: { gt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } }] }) },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return { configs: page.map(configOf), next: rows.length > limit && last !== undefined ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null };
    },
    // The pushes go with it, as the database cascades.
    remove: async ({ fleetId, party }, { taskId, id }) => (await db.a2aPushConfig.deleteMany({ where: { fleetId, party, taskId, id } })).count > 0,
    following: async ({ fleetId, party }) => (await db.a2aPushConfig.findMany({ where: { fleetId, party, isFollowing: true } })).map(configOf),
    notice: async ({ fleetId, party }, { taskId, id, mark, isFollowing, events, at }) => {
      await db.$transaction([
        db.a2aPushConfig.updateMany({ where: { fleetId, party, taskId, id }, data: { noticedMark: mark, isFollowing } }),
        db.a2aPush.createMany({ data: events.map((body) => ({ fleetId, party, taskId, configId: id, body, attempts: 0, nextAt: at, state: 'pending' })) }),
      ]);
    },
    due: async ({ fleetId, party }, { now, limit }) => {
      // Per config its oldest pending push, then only those due: a later push waits behind an earlier one tried again.
      const rows = z.array(dueRowSchema).parse(
        await db.$queryRaw<unknown[]>`
          SELECT "pushId", "taskId", "configId", "body", "attempts" FROM (
            SELECT DISTINCT ON ("task_id", "config_id") "push_id" AS "pushId", "task_id" AS "taskId", "config_id" AS "configId", "body", "attempts", "next_at" AS "nextAt"
            FROM "a2a_pushes"
            WHERE "fleet_id" = ${fleetId} AND "party" = ${party} AND "state" = 'pending'
            ORDER BY "task_id", "config_id", "push_id"
          ) AS "oldest"
          WHERE "nextAt" <= ${now}
          ORDER BY "pushId"
          LIMIT ${limit}`,
      );
      const configs = await db.a2aPushConfig.findMany({ where: { fleetId, party, OR: rows.map(({ taskId, configId }) => ({ taskId, id: configId })) } });
      return rows.flatMap((row): Push[] => {
        const config = configs.find((each) => each.taskId === row.taskId && each.id === row.configId);
        return config === undefined ? [] : [{ pushId: String(row.pushId), config: configOf(config), body: row.body, attempts: row.attempts }];
      });
    },
    delivered: async (caller, { pushId, attempts, at }) => {
      await settle(caller, { pushId, data: { state: 'delivered', attempts, settledAt: at } });
    },
    again: async (caller, { pushId, attempts, at }) => {
      await settle(caller, { pushId, data: { attempts, nextAt: at } });
    },
    givenUp: async (caller, { pushId, attempts, reason, at }) => {
      await settle(caller, { pushId, data: { state: 'givenUp', attempts, reason, settledAt: at } });
    },
  };
}
