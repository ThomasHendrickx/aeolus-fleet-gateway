import type { MeetingId, MessageId } from '@aeolus-fleet/common';

import type { CrewPersonShip } from '../people/crew-person-ship.js';
import { asPersonCrew, withOwnRefusal, type PersonCaller, type PersonCrewError } from '../people/person-crew.js';
import type { PersonCrews } from '../people/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { micStandingOf, type MicStanding } from './mic-standing.js';
import type { MeetingRead, PersonMeetingDoor } from './ports.js';

/** A meeting as a person reads it: the fleet's read, and where they stand on its mic. */
export interface PersonMeeting {
  readonly meeting: MeetingRead;
  readonly mic: MicStanding;
}

export type ReadMeeting = (input: { caller: PersonCaller; meetingId: MeetingId; cursor?: MessageId }) => Promise<Result<PersonMeeting, PersonCrewError | DomainError<'NO_SUCH_MEETING'>>>;

/**
 * Use case: a person reads a meeting they take part in, as their person ship
 * (decision 0061, M12, M19), with a page of its contributions, newest first.
 * The fleet decides who reads it, so its refusal is passed on in its words.
 * Reading acknowledges nothing: a contribution waits in the inbox until the
 * person opens it.
 */
export function createReadMeeting(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonMeetingDoor }): ReadMeeting {
  return async ({ caller, meetingId, cursor }) => {
    const asked = cursor === undefined ? { meetingId } : { meetingId, cursor };
    const read = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.meeting(crew.crewToken, asked)) });
    if (!read.isOk) {
      return read;
    }
    const meeting = read.value.value;
    if (!meeting.isOk) {
      return refuse('NO_SUCH_MEETING', `The fleet did not read the meeting to you: ${meeting.error.message}`);
    }
    return ok({ meeting: meeting.value, mic: micStandingOf(meeting.value, read.value.crew.shipId) });
  };
}
