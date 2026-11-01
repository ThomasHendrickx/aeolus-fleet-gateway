import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { asPersonCrew, personCrewOf, withOwnRefusal, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { ItemOutcomes, OutcomeKind, Place } from './item-outcome.js';
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

/** What the person did with a delivery, and where (Bridge, CC4). */
export interface DealtAs {
  readonly place: Place;
  readonly kind: OutcomeKind;
  readonly option: number | null;
}

/** What dealing with a delivery needs: the fleet as the person ship's crew, what the person opened, their pages, and the outcomes kept. */
export interface DealDeps {
  crewPersonShip: CrewPersonShip;
  crews: PersonCrews;
  door: PersonShipDoor;
  opened: OpenedDeliveries;
  changes: InboxChanges;
  outcomes: ItemOutcomes;
  clock: Clock;
}

/**
 * Reports the delivery handled, then keeps what came of it and where,
 * forgets it and tells the person's pages their inbox changed; kept while
 * the fleet does not take it, so the person can go on again.
 */
export async function handledOf(deps: DealDeps, dealt: { caller: PersonCaller; delivery: OpenedDelivery; as: DealtAs }): Promise<Result<Dealt, DealtError>> {
  const { caller, delivery } = dealt;
  const handled = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.handled(crew.crewToken, delivery.deliveryId)) });
  if (!handled.isOk) {
    return handled;
  }
  if (!handled.value.value.isOk) {
    return refuse('FLEET_UNAVAILABLE', `The fleet did not take that you dealt with it: ${handled.value.value.error.message}. Try again`);
  }
  await deps.outcomes.save({ fleetId: delivery.fleetId, shipId: delivery.shipId, deliveryId: delivery.deliveryId, ...dealt.as, at: deps.clock.now() });
  await deps.opened.remove(delivery.fleetId, { shipId: delivery.shipId, deliveryId: delivery.deliveryId });
  await deps.changes.tell({ fleetId: delivery.fleetId, shipId: delivery.shipId });
  return ok({ deliveryId: delivery.deliveryId, isHandled: true });
}
