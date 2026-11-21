import type { MessageId } from '@aeolus-fleet/common';

import type { MeetingContributions } from '../../src/core/meetings/meeting-contributions.js';

/** A person's contribution record, shared by test devices. Old arrivals are already seen. */
export function memoryMeetingContributions(): MeetingContributions {
  const records = new Map<string, { meetingId: Parameters<MeetingContributions['unseen']>[1][number]; isSeen: boolean; messageId: MessageId }>();
  return {
    note: (ship, { contributions, isSeen }) => {
      let isChanged = false;
      for (const contribution of contributions) {
        const key = `${ship.fleetId}/${ship.shipId}/${contribution.meetingId}/${contribution.messageId}`;
        const earlier = records.get(key);
        isChanged = isChanged || earlier === undefined || (isSeen && !earlier.isSeen);
        records.set(key, { messageId: contribution.messageId, meetingId: contribution.meetingId, isSeen: isSeen || records.get(key)?.isSeen === true });
      }
      return Promise.resolve(isChanged);
    },
    unseenMeetings: (ship) => {
      const meetings = new Map<Parameters<MeetingContributions['unseen']>[1][number], { count: number; newest: MessageId }>();
      for (const [key, row] of records) {
        if (!key.startsWith(`${ship.fleetId}/${ship.shipId}/`) || row.isSeen) { continue; }
        const earlier = meetings.get(row.meetingId);
        meetings.set(row.meetingId, { count: (earlier?.count ?? 0) + 1, newest: earlier === undefined || row.messageId > earlier.newest ? row.messageId : earlier.newest });
      }
      return Promise.resolve([...meetings].sort((left, right) => right[1].newest.localeCompare(left[1].newest)).slice(0, 20).map(([meetingId, { count }]) => ({ meetingId, count })));
    },
    unseen: (ship, meetingIds) => Promise.resolve(meetingIds.map((meetingId) => ({ meetingId, count: [...records].filter(([key, row]) => key.startsWith(`${ship.fleetId}/${ship.shipId}/${meetingId}/`) && !row.isSeen).length }))),
  };
}
