import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { asPersonCrew, personCrewOf, withOwnRefusal, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { InboxChanges, OpenedDeliveries, OpenedDelivery, PersonCrews, PersonShipDoor } from './ports.js';

/** What a person dealt with a delivery as: answered, or done with it. */
export interface Dealt {
  readonly deliveryId: string;
  readonly isHandled: true;
}

export type DealtError = PersonCrewError | DomainError<'NO_SUCH_DELIVERY'>;

/** A delivery the caller opened on their person ship. */
export async function openedOf(
  deps: { crewPersonShip: CrewPersonShip; opened: OpenedDeliveries },
  asked: { caller: PersonCaller; deliveryId: string },
): Promise<Result<OpenedDelivery, DealtError>> {
  const { caller, deliveryId } = asked;
  const crew = await personCrewOf(deps.crewPersonShip, caller);
  if (!crew.isOk) {
    return crew;
  }
  const delivery = await deps.opened.find(caller.fleetId, { shipId: crew.value.shipId, deliveryId });
  if (!delivery) {
    return refuse('NO_SUCH_DELIVERY', `You have no opened delivery ${deliveryId}: open it from your inbox first`);
  }
  return ok(delivery);
}

/**
 * Reports the delivery handled, then forgets it and tells the person's pages
 * their inbox changed; kept while the fleet does not take it, so the person
 * can go on again.
 */
export async function handledOf(
  deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor; opened: OpenedDeliveries; changes: InboxChanges },
  dealt: { caller: PersonCaller; delivery: OpenedDelivery },
): Promise<Result<Dealt, DealtError>> {
  const { caller, delivery } = dealt;
  const handled = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.handled(crew.crewToken, delivery.deliveryId)) });
  if (!handled.isOk) {
    return handled;
  }
  if (!handled.value.value.isOk) {
    return refuse('FLEET_UNAVAILABLE', `The fleet did not take that you dealt with it: ${handled.value.value.error.message}. Try again`);
  }
  await deps.opened.remove(delivery.fleetId, { shipId: delivery.shipId, deliveryId: delivery.deliveryId });
  await deps.changes.tell({ fleetId: delivery.fleetId, shipId: delivery.shipId });
  return ok({ deliveryId: delivery.deliveryId, isHandled: true });
}
