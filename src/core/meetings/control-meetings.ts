/** Person meeting calls use only their own crew; core decides each operation. */
import type { MeetingsOutput, MeetingId } from '@aeolus-fleet/common';

import type { CrewPersonShip } from '../people/crew-person-ship.js';
import { asPersonCrew, withOwnRefusal, type PersonCaller, type PersonCrewError } from '../people/person-crew.js';
import type { PersonCrews } from '../people/ports.js';
import type { FleetRefusal } from '../connection/ports.js';
import type { DomainError } from '../shared/errors.js';
import { err, ok, type Result } from '../shared/result.js';
import type { MeetingCommand, MeetingControls, MeetingPageInput } from './control-ports.js';

type MeetingError = PersonCrewError | (DomainError<'MEETING_REFUSED'> & FleetRefusal);

export interface ControlMeetings {
  list(input: { caller: PersonCaller; page: MeetingPageInput }): Promise<Result<MeetingsOutput, MeetingError>>;
  change(input: { caller: PersonCaller; command: MeetingCommand }): Promise<Result<{ meetingId?: MeetingId }, MeetingError>>;
}

export function createControlMeetings(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: MeetingControls }): ControlMeetings {
  return {
    list: async ({ caller, page }) => {
      const read = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.list(crew.crewToken, page)) });
      if (!read.isOk) return read;
      const answer = read.value.value;
      return answer.isOk ? ok(answer.value) : err({ kind: 'MEETING_REFUSED', ...answer.error });
    },
    change: async ({ caller, command }) => {
      const changed = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.change(crew.crewToken, command)) });
      if (!changed.isOk) return changed;
      const answer = changed.value.value;
      return answer.isOk ? ok(answer.value) : err({ kind: 'MEETING_REFUSED', ...answer.error });
    },
  };
}
