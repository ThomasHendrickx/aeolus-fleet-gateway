/** Records contributions before handing received deliveries to any person use case. Core can replay after a failed write. */
import { isMeetingNotice } from '../people/item-job.js';
import type { PersonShipDoor } from '../people/ports.js';
import type { MeetingContributions, NotedContribution } from './meeting-contributions.js';

export function createRecordingMeetingDoor(door: PersonShipDoor, contributions: MeetingContributions): PersonShipDoor {
  return {
    ...door,
    pushReceive: async (crewToken, take) => {
      const received = await door.pushReceive(crewToken, take);
      if (!received.isOk) { return received; }
      const arrived: NotedContribution[] = received.value.flatMap(({ meetingId, messageId, sentAt, contentType }) => meetingId === null || isMeetingNotice(contentType) ? [] : [{ meetingId, messageId, sentAt }]);
      if (arrived.length > 0) {
        const who = await door.whoami(crewToken);
        if (!who.isOk) { return who; }
        await contributions.note(who.value, { contributions: arrived, isSeen: false });
      }
      return received;
    },
  };
}
