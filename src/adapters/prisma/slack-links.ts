import { idSchema } from '@aeolus-fleet/common';

import type { SlackLinks } from '../../core/slack/ports.js';
import type { SlackLink } from '../../core/slack/slack-link.js';
import type { PrismaClient } from './client.js';
import type { SlackLink as SlackLinkRow } from './generated/client.js';

function linkOf(row: SlackLinkRow): SlackLink {
  return {
    fleetId: idSchema('fleet').parse(row.fleetId),
    teamId: row.teamId,
    slackUserId: row.slackUserId,
    slackName: row.slackName,
    accountId: row.accountId,
    personShipId: idSchema('ship').parse(row.personShipId),
    linkedAt: row.linkedAt,
    stoppedAt: row.stoppedAt,
  };
}

/**
 * Each fleet's Slack links, one row per Slack user and one per account in
 * the fleet: the database keeps one of two links added at once, by its two
 * unique keys.
 */
export function createPrismaSlackLinks(db: PrismaClient): SlackLinks {
  return {
    find: async (fleetId, { teamId, userId }) => {
      const row = await db.slackLink.findUnique({ where: { fleetId_teamId_slackUserId: { fleetId, teamId, slackUserId: userId } } });
      return row === null ? undefined : linkOf(row);
    },
    ofAccount: async (fleetId, accountId) => {
      const row = await db.slackLink.findUnique({ where: { fleetId_accountId: { fleetId, accountId } } });
      return row === null ? undefined : linkOf(row);
    },
    add: async (link) => {
      const { count } = await db.slackLink.createMany({ data: [link], skipDuplicates: true });
      return count === 1 ? 'added' : 'taken';
    },
    remove: async (fleetId, accountId) => {
      await db.slackLink.deleteMany({ where: { fleetId, accountId } });
    },
    stop: async (fleetId, { accountId, at }) => {
      await db.slackLink.updateMany({ where: { fleetId, accountId, stoppedAt: null }, data: { stoppedAt: at } });
    },
  };
}
