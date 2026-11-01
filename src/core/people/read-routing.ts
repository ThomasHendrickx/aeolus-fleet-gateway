import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import type { ItemJob } from './item-job.js';
import { personCrewOf, type PersonCaller, type PersonCrewError } from './person-crew.js';
import { ITEM_JOBS, routingOf, type RoutingDefaults, type RoutingPlace, type Routes } from './routing.js';
import { isOfferedPlace } from './turn-route.js';

/** Where each job shows besides Bridge, as Bridge's routing page draws it, and the places the gateway offers. */
export interface RoutingView {
  readonly offered: Readonly<Record<RoutingPlace, boolean>>;
  readonly jobs: readonly { readonly job: ItemJob; readonly places: Readonly<Record<RoutingPlace, boolean>> }[];
}

export type ReadRouting = (caller: PersonCaller) => Promise<Result<RoutingView, PersonCrewError>>;

const placesOf = (isOn: (place: RoutingPlace) => boolean): Record<RoutingPlace, boolean> => ({ slack: isOn('slack'), chat: isOn('chat'), 'web-push': isOn('web-push'), email: isOn('email') });

/**
 * Use case: where the caller's items show, per job and place (Bridge,
 * section 8): their own choices, the gateway's defaults where they made
 * none (CC19).
 */
export function createReadRouting(deps: { crewPersonShip: CrewPersonShip; routes: Routes; defaults: RoutingDefaults; isEmailOffered: boolean; isWebPushOffered: boolean }): ReadRouting {
  return async (caller) => {
    const crew = await personCrewOf(deps.crewPersonShip, caller);
    if (!crew.isOk) {
      return crew;
    }
    const routing = routingOf(await deps.routes.list({ fleetId: caller.fleetId, shipId: crew.value.shipId }), deps.defaults);
    const offered = placesOf((place) => isOfferedPlace(place, deps));
    return ok({ offered, jobs: ITEM_JOBS.map((job) => ({ job, places: placesOf((place) => routing.isOn(job, place)) })) });
  };
}
