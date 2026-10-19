import type { PartyStore } from '../parties/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { OpenedDeliveries, OpenedDelivery, PersonShipDoor } from './ports.js';
import { crewedPersonOf, type PersonCaller } from './read-inbox.js';

/** What a person dealt with a delivery as: answered, or done with it. */
export interface Dealt {
  readonly deliveryId: string;
  readonly isHandled: true;
}

export type DealtError = DomainError<'NOT_A_PERSON' | 'NO_SUCH_DELIVERY' | 'FLEET_UNAVAILABLE'>;

/** The caller's crewed person's ship and a delivery they opened. */
export async function openedOf(
  deps: { parties: PartyStore; opened: OpenedDeliveries },
  asked: { caller: PersonCaller; deliveryId: string },
): Promise<Result<{ crewToken: string; delivery: OpenedDelivery }, DealtError>> {
  const { caller, deliveryId } = asked;
  const person = await crewedPersonOf(deps.parties, caller);
  if (!person) {
    return refuse('NOT_A_PERSON', `The party ${caller.party} is no person's ship the gateway crews`);
  }
  const delivery = await deps.opened.find(caller.fleetId, { party: caller.party, deliveryId });
  if (!delivery) {
    return refuse('NO_SUCH_DELIVERY', `You have no opened delivery ${deliveryId}: open it from your inbox first`);
  }
  return ok({ crewToken: person.crewToken, delivery });
}

/** Reports the delivery handled, then forgets it; kept while the fleet does not take it, so the person can go on again. */
export async function handledOf(
  deps: { door: PersonShipDoor; opened: OpenedDeliveries },
  dealt: { crewToken: string; delivery: OpenedDelivery },
): Promise<Result<Dealt, DealtError>> {
  const { crewToken, delivery } = dealt;
  const handled = await deps.door.handled(crewToken, delivery.deliveryId);
  if (!handled.isOk) {
    return refuse('FLEET_UNAVAILABLE', `The fleet did not take that you dealt with it: ${handled.error.message}. Try again`);
  }
  await deps.opened.remove(delivery.fleetId, { party: delivery.party, deliveryId: delivery.deliveryId });
  return ok({ deliveryId: delivery.deliveryId, isHandled: true });
}
