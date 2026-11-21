/** Records contributions before handing received deliveries to any person use case. Core can replay after a failed write. */
import { isMeetingContribution } from './is-meeting-contribution.js';
import type { InboxChanges, PersonShipDoor } from '../people/ports.js';
import type { MeetingContributions, NotedContribution } from './meeting-contributions.js';

export function createRecordingMeetingDoor(door: PersonShipDoor, deps: { contributions: MeetingContributions; changes: InboxChanges }): PersonShipDoor {
  return {
    ...door,
    pushReceive: async (crewToken, take) => {
      const received = await door.pushReceive(crewToken, take);
      if (!received.isOk) { return received; }
      const arrived: NotedContribution[] = received.value.filter(isMeetingContribution).map(({ meetingId, messageId, sentAt }) => ({ meetingId, messageId, sentAt }));
      if (arrived.length > 0) {
        const who = await door.whoami(crewToken);
        if (!who.isOk) { return who; }
        const isChanged = await deps.contributions.note(who.value, { contributions: arrived, isSeen: false });
        if (isChanged) { await deps.changes.tell({ fleetId: who.value.fleetId, shipId: who.value.shipId }); }
      }
      return received;
    },
  };
}
