import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { SlackPosts } from '../../core/slack/ports.js';
import type { SlackPost } from '../../core/slack/slack-post.js';
import type { PrismaClient } from './client.js';
import type { SlackPost as SlackPostRow } from './generated/client.js';

const placeSchema = z.enum(['bridge', 'chat', 'slack', 'gateway']);
const kindSchema = z.enum(['seen', 'answered', 'done', 'cannot', 'withdrawn', 'replaced', 'notSent']);

/** A post to edit as the database reads it: the post, in Slack, and what came of its item. */
const toEditSchema = z.object({
  fleetId: idSchema('fleet'),
  personShipId: idSchema('ship'),
  messageId: idSchema('message'),
  deliveryId: idSchema('delivery'),
  senderShipId: idSchema('ship').nullable(),
  appId: z.string(),
  channel: z.string(),
  ts: z.string(),
  threadTs: z.string().nullable(),
  place: placeSchema,
  kind: kindSchema,
  option: z.number().int().nullable(),
  at: z.date(),
});

function postOf(row: SlackPostRow): SlackPost {
  return {
    fleetId: idSchema('fleet').parse(row.fleetId),
    personShipId: idSchema('ship').parse(row.personShipId),
    messageId: idSchema('message').parse(row.messageId),
    deliveryId: row.deliveryId === null ? null : idSchema('delivery').parse(row.deliveryId),
    senderShipId: row.senderShipId === null ? null : idSchema('ship').parse(row.senderShipId),
    appId: row.appId,
    channel: row.channel,
    ts: row.ts,
    threadTs: row.threadTs,
  };
}

/** The fleet messages in Slack, one row per fleet, person ship and message. */
export function createPrismaSlackPosts(db: PrismaClient): SlackPosts {
  return {
    save: async (post) => {
      const { fleetId, personShipId, messageId, ...rest } = post;
      await db.slackPost.upsert({ where: { fleetId_personShipId_messageId: { fleetId, personShipId, messageId } }, create: post, update: rest });
    },
    ofMessage: async (fleetId, { personShipId, messageId }) => {
      const row = await db.slackPost.findUnique({ where: { fleetId_personShipId_messageId: { fleetId, personShipId, messageId } } });
      return row === null ? undefined : postOf(row);
    },
    lastInThread: async (fleetId, { personShipId, appId, channel, threadTs }) => {
      const row = await db.slackPost.findFirst({ where: { fleetId, personShipId, appId, channel, deliveryId: { not: null }, OR: [{ threadTs }, { ts: threadTs }] }, orderBy: { ts: 'desc' } });
      return row === null ? undefined : postOf(row);
    },
    unfinished: async (fleetId, personShipId) =>
      (await db.slackPost.findMany({ where: { fleetId, personShipId, deliveryId: { not: null }, ts: null } })).map(postOf),
    remove: async (fleetId, { personShipId, messageId }) => {
      await db.slackPost.deleteMany({ where: { fleetId, personShipId, messageId } });
    },
    toEdit: async ({ limit }) => {
      const rows: unknown[] = await db.$queryRaw`
        SELECT p."fleet_id" AS "fleetId", p."person_ship_id" AS "personShipId", p."message_id" AS "messageId", p."delivery_id" AS "deliveryId",
               p."sender_ship_id" AS "senderShipId", p."app_id" AS "appId", p."channel", p."ts", p."thread_ts" AS "threadTs",
               o."place", o."kind", o."option", o."at"
        FROM "slack_posts" p
        JOIN "item_outcomes" o ON o."fleet_id" = p."fleet_id" AND o."ship_id" = p."person_ship_id" AND o."delivery_id" = p."delivery_id"
        WHERE p."edited_at" IS NULL AND p."delivery_id" IS NOT NULL AND p."ts" IS NOT NULL
        ORDER BY o."at", p."fleet_id", p."person_ship_id", p."message_id"
        LIMIT ${limit}`;
      return rows.map((row) => {
        const { place, kind, option, at, ...post } = toEditSchema.parse(row);
        return { post, outcome: { place, kind, option, at } };
      });
    },
    markEdited: async (fleetId, { personShipId, messageId }) => {
      await db.slackPost.updateMany({ where: { fleetId, personShipId, messageId }, data: { editedAt: new Date() } });
    },
  };
}
