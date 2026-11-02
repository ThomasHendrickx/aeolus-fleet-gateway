import { idSchema } from '@aeolus-fleet/common';

import type { ArgoSlackPosts } from '../../core/argo-inbox/ports.js';
import type { Db } from './client.js';

/** The messages open at argo in Slack, a row each by fleet, person ship and message. */
export function createPrismaArgoSlackPosts(db: Db): ArgoSlackPosts {
  return {
    list: async (fleetId) => {
      const rows = await db.argoSlackPost.findMany({ where: { fleetId }, orderBy: [{ personShipId: 'asc' }, { messageId: 'asc' }] });
      return rows.map(({ personShipId, messageId, appId, channel, ts, isGivenUp }) => ({
        fleetId,
        personShipId: idSchema('ship').parse(personShipId),
        messageId: idSchema('message').parse(messageId),
        appId,
        channel,
        ts,
        isGivenUp,
      }));
    },
    keep: async (post) => {
      // Two rounds at once keep it once: the second finds it known.
      const { count } = await db.argoSlackPost.createMany({ data: [post], skipDuplicates: true });
      return count === 0 ? 'known' : 'kept';
    },
    save: async ({ fleetId, personShipId, messageId, appId, channel, ts, isGivenUp }) => {
      await db.argoSlackPost.updateMany({ where: { fleetId, personShipId, messageId }, data: { appId, channel, ts, isGivenUp } });
    },
    remove: async (fleetId, { personShipId, messageId }) => {
      await db.argoSlackPost.deleteMany({ where: { fleetId, personShipId, messageId } });
    },
  };
}
