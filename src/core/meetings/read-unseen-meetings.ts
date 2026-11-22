/** A bounded page from the person's contribution record, independent of the meeting list. */
import type { CrewPersonShip } from '../people/crew-person-ship.js';
import { personCrewOf, type PersonCaller, type PersonCrewError } from '../people/person-crew.js';
import { ok, type Result } from '../shared/result.js';
import type { MeetingContributions, UnseenContributions } from './meeting-contributions.js';

export type ReadUnseenMeetings = (caller: PersonCaller) => Promise<Result<UnseenContributions[], PersonCrewError>>;

export function createReadUnseenMeetings(deps: { crewPersonShip: CrewPersonShip; contributions: MeetingContributions }): ReadUnseenMeetings {
  return async (caller) => {
    const crew = await personCrewOf(deps.crewPersonShip, caller);
    if (!crew.isOk) { return crew; }
    return ok(await deps.contributions.unseenMeetings({ fleetId: caller.fleetId, shipId: crew.value.shipId }));
  };
}
