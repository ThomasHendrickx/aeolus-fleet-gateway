import type { CrewPersonShip } from '../people/crew-person-ship.js';
import { asPersonCrew, withOwnRefusal, type PersonCaller, type PersonCrewError } from '../people/person-crew.js';
import type { InboxChanges, PersonCrews } from '../people/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { micStandingOf, type MicStanding } from './mic-standing.js';
import type { MeetingContributions } from './meeting-contributions.js';
import type { MeetingRead, MeetingReadInput, PersonMeetingDoor } from './ports.js';

/** A meeting as a person reads it: the fleet's read, and where they stand on its mic. */
export interface PersonMeeting {
  readonly meeting: MeetingRead;
  readonly mic: MicStanding;
}

export type ReadMeeting = (input: MeetingReadInput & { caller: PersonCaller }) => Promise<Result<PersonMeeting, PersonCrewError | DomainError<'NO_SUCH_MEETING'>>>;

/**
 * Use case: a person reads a meeting as their own ship, including before
 * joining when core allows it, with bounded contribution and progress pages.
 * The fleet decides who reads it, so its refusal is passed on in its words.
 * Reading records only the contributions on this page as seen in the person
 * record, including sightings that precede arrival. It acknowledges no delivery.
 */
export function createReadMeeting(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonMeetingDoor; contributions: MeetingContributions; changes: InboxChanges }): ReadMeeting {
  return async ({ caller, ...asked }) => {
    const { meetingId } = asked;
    const read = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.meeting(crew.crewToken, asked)) });
    if (!read.isOk) {
      return read;
    }
    const meeting = read.value.value;
    if (!meeting.isOk) {
      return refuse('NO_SUCH_MEETING', `The fleet did not read the meeting to you: ${meeting.error.message}`);
    }
    const ship = { fleetId: caller.fleetId, shipId: read.value.crew.shipId };
    const isChanged = await deps.contributions.note(ship, { contributions: meeting.value.contributions.items.filter(({ sender }) => sender.shipId !== ship.shipId).map(({ messageId, sentAt }) => ({ meetingId, messageId, sentAt })), isSeen: true });
    if (isChanged) { await deps.changes.tell(ship); }
    return ok({ meeting: meeting.value, mic: micStandingOf(meeting.value, read.value.crew.shipId) });
  };
}
