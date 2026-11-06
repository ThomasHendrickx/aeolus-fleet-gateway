import type { Clock } from '../shared/clock.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import type { HeldDeliveries } from './held-deliveries.js';
import { personCrewOf, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { PersonCrews, PersonShipDoor } from './ports.js';
import { quietSpellAt, type QuietHoursStore, type QuietSpell, type QuietWindow } from './quiet-hours.js';
import { waitingFor } from './read-inbox.js';

/** A person's quiet hours as their client draws them: on or off, the window set, if any, and the spell in effect now with how many of what waits arrived since it began, if any. */
export interface QuietHoursView {
  readonly isOn: boolean;
  readonly window: QuietWindow | null;
  readonly quietNow: (QuietSpell & { readonly arrived: number }) | null;
}

export type ReadQuietHours = (caller: PersonCaller) => Promise<Result<QuietHoursView, PersonCrewError>>;

/**
 * Use case: a person's client reads their quiet hours (preferences design);
 * off with no window while they set none. While they are in effect, it
 * counts what waits that arrived since they began, from what waits as the
 * inbox reads it; outside them it asks the fleet nothing.
 */
export function createReadQuietHours(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor; held: HeldDeliveries; quietHours: Pick<QuietHoursStore, 'find'>; clock: Clock }): ReadQuietHours {
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
    const window = { fromMinute, toMinute, timeZone };
    const spell = quietSpellAt(hours, deps.clock.now());
    if (spell === undefined) {
      return ok({ isOn, window, quietNow: null });
    }
    const waiting = await waitingFor(deps, caller);
    if (!waiting.isOk) {
      return waiting;
    }
    const arrived = waiting.value.deliveries.filter(({ sentAt }) => sentAt.getTime() >= spell.since.getTime()).length;
    return ok({ isOn, window, quietNow: { ...spell, arrived } });
  };
}
