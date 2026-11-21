/** Counts the person's requested meetings from their record, with no delivery or meeting-history scan. */
import type { MeetingId } from '@aeolus-fleet/common';

import type { CrewPersonShip } from '../people/crew-person-ship.js';
import { personCrewOf, type PersonCaller, type PersonCrewError } from '../people/person-crew.js';
import { ok, type Result } from '../shared/result.js';
import type { MeetingContributions, UnseenContributions } from './meeting-contributions.js';

export type ReadUnseenContributions = (input: { caller: PersonCaller; meetingIds: readonly MeetingId[] }) => Promise<Result<UnseenContributions[], PersonCrewError>>;

export function createReadUnseenContributions(deps: { crewPersonShip: CrewPersonShip; contributions: MeetingContributions }): ReadUnseenContributions {
  return async ({ caller, meetingIds }) => {
    const crew = await personCrewOf(deps.crewPersonShip, caller);
    if (!crew.isOk) { return crew; }
    return ok(await deps.contributions.unseen({ fleetId: caller.fleetId, shipId: crew.value.shipId }, [...new Set(meetingIds)]));
  };
}
