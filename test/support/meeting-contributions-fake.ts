import type { MeetingContributions } from '../../src/core/meetings/meeting-contributions.js';

/** A person's contribution record, shared by test devices. Old arrivals are already seen. */
export function memoryMeetingContributions(): MeetingContributions {
  const records = new Map<string, { meetingId: Parameters<MeetingContributions['unseen']>[1][number]; isSeen: boolean }>();
  return {
    note: async (ship, contributions, isSeen) => {
      for (const contribution of contributions) {
        const key = `${ship.fleetId}/${ship.shipId}/${contribution.meetingId}/${contribution.messageId}`;
        records.set(key, { meetingId: contribution.meetingId, isSeen: isSeen || records.get(key)?.isSeen === true });
      }
    },
    unseen: async (ship, meetingIds) => meetingIds.map((meetingId) => ({ meetingId, count: [...records].filter(([key, row]) => key.startsWith(`${ship.fleetId}/${ship.shipId}/${meetingId}/`) && !row.isSeen).length })),
  };
}
