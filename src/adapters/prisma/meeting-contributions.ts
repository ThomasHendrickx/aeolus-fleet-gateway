/** Durable per-person contribution index. Atomic upserts make arrival replay and page sightings commute. */
import { idSchema } from '@aeolus-fleet/common';

import type { MeetingContributions } from '../../core/meetings/meeting-contributions.js';
import type { Db } from './client.js';

export function createPrismaMeetingContributions(db: Db): MeetingContributions {
  // The database rollout, shared by every gateway instance and restart. No delivery history is backfilled.
  const countingStarted = async (): Promise<Date> => {
    const rows = await db.$queryRaw<{ started_at: Date }[]>`SELECT started_at FROM _prisma_migrations WHERE migration_name = '20261121100000_meeting_contributions' AND finished_at IS NOT NULL`;
    const at = rows[0]?.started_at;
    if (at === undefined) { throw new Error('Meeting contribution counting migration has not completed'); }
    return at;
  };
  return {
    note: async ({ fleetId, shipId }, { contributions, isSeen }) => {
      if (contributions.length === 0) { return false; }
      const since = await countingStarted();
      let isChanged = false;
      for (const { meetingId, messageId, sentAt } of contributions) {
        if (sentAt < since) { continue; }
        const changed = await db.$executeRaw`
          INSERT INTO meeting_contributions (fleet_id, ship_id, meeting_id, message_id, is_seen)
          VALUES (${fleetId}, ${shipId}, ${meetingId}, ${messageId}, ${isSeen})
          ON CONFLICT (fleet_id, ship_id, meeting_id, message_id)
          DO UPDATE SET is_seen = TRUE
          WHERE NOT meeting_contributions.is_seen AND EXCLUDED.is_seen`;
        isChanged = changed > 0 || isChanged;
      }
      return isChanged;
    },
    unseen: async ({ fleetId, shipId }, meetingIds) => {
      const rows = await db.meetingContribution.groupBy({ by: ['meetingId'], where: { fleetId, shipId, meetingId: { in: [...meetingIds] }, isSeen: false }, _count: true });
      const counts = new Map(rows.map((row) => [idSchema('meeting').parse(row.meetingId), row._count]));
      return meetingIds.map((meetingId) => ({ meetingId, count: counts.get(meetingId) ?? 0 }));
    },
  };
}
