import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import type { ItemJob } from './item-job.js';
import { personCrewOf, type PersonCaller, type PersonCrewError } from './person-crew.js';
import { routingOf, type RoutingDefaults, type RoutingPlace, type Routes } from './routing.js';

export type TurnRoute = (turn: { caller: PersonCaller; job: ItemJob; place: RoutingPlace; isOn: boolean }) => Promise<Result<undefined, PersonCrewError | DomainError<'CHANNEL_NOT_OFFERED'>>>;

/** Whether the gateway can show anything in the place: email where it asks pagasae to send it, web push where it holds push keys. */
export function isOfferedPlace(place: RoutingPlace, offered: { isEmailOffered: boolean; isWebPushOffered: boolean }): boolean {
  switch (place) {
    case 'email':
      return offered.isEmailOffered;
    case 'web-push':
      return offered.isWebPushOffered;
    case 'slack':
    case 'chat':
      return true;
  }
}

/**
 * Use case: a person turns a place on or off for a job (Bridge, section 8),
 * kept by fleet, person ship, job and place; it applies at once, as the
 * waiter and the chat read it anew each time. A place already as asked is
 * kept as it is, so a push place turned on keeps showing what arrived since
 * then (CC20). Turning a place on is refused where the gateway cannot show
 * anything there.
 */
export function createTurnRoute(deps: { crewPersonShip: CrewPersonShip; routes: Routes; defaults: RoutingDefaults; isEmailOffered: boolean; isWebPushOffered: boolean; clock: Clock }): TurnRoute {
  return async ({ caller, job, place, isOn }) => {
    if (isOn && !isOfferedPlace(place, deps)) {
      return refuse('CHANNEL_NOT_OFFERED', place === 'email' ? 'This gateway sends no email' : 'This gateway sends no web push');
    }
    const crew = await personCrewOf(deps.crewPersonShip, caller);
    if (!crew.isOk) {
      return crew;
    }
    const ship = { fleetId: caller.fleetId, shipId: crew.value.shipId };
    if (routingOf(await deps.routes.list(ship), deps.defaults).isOn(job, place) === isOn) {
      return ok(undefined);
    }
    await deps.routes.save({ ...ship, job, place, isOn, changedAt: deps.clock.now() });
    return ok(undefined);
  };
}
