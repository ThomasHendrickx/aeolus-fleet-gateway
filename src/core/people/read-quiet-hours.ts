import type { Clock } from '../shared/clock.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { personCrewOf, type PersonCaller, type PersonCrewError } from './person-crew.js';
import { quietSpellAt, type QuietHoursStore, type QuietSpell, type QuietWindow } from './quiet-hours.js';

/** A person's quiet hours as their client draws them: on or off, the window set, if any, and the spell in effect now, if any. */
export interface QuietHoursView {
  readonly isOn: boolean;
  readonly window: QuietWindow | null;
  readonly quietNow: QuietSpell | null;
}

export type ReadQuietHours = (caller: PersonCaller) => Promise<Result<QuietHoursView, PersonCrewError>>;

/** Use case: a person's client reads their quiet hours (preferences design); off with no window while they set none. */
export function createReadQuietHours(deps: { crewPersonShip: CrewPersonShip; quietHours: Pick<QuietHoursStore, 'find'>; clock: Clock }): ReadQuietHours {
  return async (caller) => {
    const crew = await personCrewOf(deps.crewPersonShip, caller);
    if (!crew.isOk) {
      return crew;
    }
    const hours = await deps.quietHours.find({ fleetId: caller.fleetId, shipId: crew.value.shipId });
    if (hours === undefined) {
      return ok({ isOn: false, window: null, quietNow: null });
    }
    const { isOn, fromMinute, toMinute, timeZone } = hours;
    return ok({ isOn, window: { fromMinute, toMinute, timeZone }, quietNow: quietSpellAt(hours, deps.clock.now()) ?? null });
  };
}
