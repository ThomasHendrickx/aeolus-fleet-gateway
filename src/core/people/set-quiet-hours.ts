import type { Clock } from '../shared/clock.js';
import type { DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { personCrewOf, type PersonCaller, type PersonCrewError } from './person-crew.js';
import { quietWindowOf, type QuietHoursStore, type QuietWindow } from './quiet-hours.js';

export type SetQuietHours = (set: { caller: PersonCaller; isOn: boolean } & QuietWindow) => Promise<Result<undefined, PersonCrewError | DomainError<'INVALID_QUIET_HOURS'>>>;

/**
 * Use case: a person sets their quiet hours (preferences design), on or off
 * with their window, kept by fleet and person ship with when they set them.
 * It applies at once, as every wake reads them anew. A window that is not
 * one is refused, keeping nothing.
 */
export function createSetQuietHours(deps: { crewPersonShip: CrewPersonShip; quietHours: Pick<QuietHoursStore, 'save'>; clock: Clock }): SetQuietHours {
  return async ({ caller, isOn, ...asked }) => {
    const window = quietWindowOf(asked);
    if (!window.isOk) {
      return window;
    }
    const crew = await personCrewOf(deps.crewPersonShip, caller);
    if (!crew.isOk) {
      return crew;
    }
    await deps.quietHours.save({ fleetId: caller.fleetId, shipId: crew.value.shipId, isOn, ...window.value, changedAt: deps.clock.now() });
    return ok(undefined);
  };
}
