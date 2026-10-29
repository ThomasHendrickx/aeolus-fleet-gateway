import { idSchema } from '@aeolus-fleet/common';

import type { SlackPosts } from '../../core/slack/ports.js';
import type { SlackPost } from '../../core/slack/slack-post.js';
import type { PrismaClient } from './client.js';
import type { SlackPost as SlackPostRow } from './generated/client.js';

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
    isLinkOnly: row.isLinkOnly,
    ackedAt: row.ackedAt,
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
      (await db.slackPost.findMany({ where: { fleetId, personShipId, deliveryId: { not: null }, OR: [{ ts: null }, { isLinkOnly: false, ackedAt: null }] } })).map(postOf),
    remove: async (fleetId, { personShipId, messageId }) => {
      await db.slackPost.deleteMany({ where: { fleetId, personShipId, messageId } });
    },
  };
}
