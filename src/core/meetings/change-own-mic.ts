import type { MeetingId } from '@aeolus-fleet/common';

import type { CrewPersonShip } from '../people/crew-person-ship.js';
import { asPersonCrew, withOwnRefusal, type PersonCaller, type PersonCrewError } from '../people/person-crew.js';
import type { PersonCrews } from '../people/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { OwnMicChange, PersonMeetingDoor } from './ports.js';

export type ChangeOwnMic = (input: { caller: PersonCaller; meetingId: MeetingId; change: OwnMicChange }) => Promise<Result<undefined, PersonCrewError | DomainError<'MIC_REFUSED'>>>;

/**
 * Use case: a person requests a meeting's mic, withdraws their request, or
 * releases the mic they hold, as their person ship (decision 0061, M8, M10,
 * M19). The mic is core's state: the gateway adds no rule of its own and
 * passes the fleet's reason on when it refuses. A request stays on the list
 * until it is served or withdrawn, so a person who reads slowly loses no place.
 */
export function createChangeOwnMic(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonMeetingDoor }): ChangeOwnMic {
  return async ({ caller, meetingId, change }) => {
    const changed = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.changeMic(crew.crewToken, { meetingId, change })) });
    if (!changed.isOk) {
      return changed;
    }
    const taken = changed.value.value;
    return taken.isOk ? ok(undefined) : refuse('MIC_REFUSED', `The fleet did not change the mic: ${taken.error.message}`);
  };
}
