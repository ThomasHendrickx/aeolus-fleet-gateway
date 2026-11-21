import type { MeetingContributions } from '../../src/core/meetings/meeting-contributions.js';

/** A person's contribution record, shared by test devices. Old arrivals are already seen. */
export function memoryMeetingContributions(): MeetingContributions {
  const records = new Map<string, { meetingId: Parameters<MeetingContributions['unseen']>[1][number]; isSeen: boolean }>();
  return {
    note: (ship, { contributions, isSeen }) => {
      let isChanged = false;
      for (const contribution of contributions) {
        const key = `${ship.fleetId}/${ship.shipId}/${contribution.meetingId}/${contribution.messageId}`;
        const earlier = records.get(key);
        isChanged = isChanged || earlier === undefined || (isSeen && !earlier.isSeen);
        records.set(key, { meetingId: contribution.meetingId, isSeen: isSeen || records.get(key)?.isSeen === true });
      }
      return Promise.resolve(isChanged);
    },
    unseen: (ship, meetingIds) => Promise.resolve(meetingIds.map((meetingId) => ({ meetingId, count: [...records].filter(([key, row]) => key.startsWith(`${ship.fleetId}/${ship.shipId}/${meetingId}/`) && !row.isSeen).length }))),
  };
}
