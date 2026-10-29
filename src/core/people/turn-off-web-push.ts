import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { personCrewOf, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { WebPushSubscriptions } from './ports.js';

export type TurnOffWebPush = (input: { caller: PersonCaller; endpoint: string }) => Promise<Result<undefined, PersonCrewError>>;

/** Use case: a person removes a browser they turned web push on in (wake a person, W8): it takes no wake again. */
export function createTurnOffWebPush(deps: { crewPersonShip: CrewPersonShip; subscriptions: WebPushSubscriptions }): TurnOffWebPush {
  return async ({ caller, endpoint }) => {
    const crew = await personCrewOf(deps.crewPersonShip, caller);
    if (!crew.isOk) {
      return crew;
    }
    await deps.subscriptions.remove(caller.fleetId, { shipId: crew.value.shipId, endpoint });
    return ok(undefined);
  };
}
