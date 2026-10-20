import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { inboxEntryOf, titleOf, type InboxEntry } from './inbox-entry.js';
import { asPersonCrew, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { OpenedDeliveries, PersonCrews, PersonShipDoor } from './ports.js';
import { waitingFor } from './read-inbox.js';

/** A delivery as a person opens it: whole. */
export interface OpenedView extends InboxEntry {
  readonly contentType: string;
  readonly payload: string;
}

export type OpenDelivery = (input: { caller: PersonCaller; deliveryId: string }) => Promise<Result<OpenedView, PersonCrewError | DomainError<'NO_SUCH_DELIVERY'>>>;

/**
 * Use case: a person opens one delivery that waits for their person ship
 * (Q20). Opening is their own act, so the gateway, as the ship's crew,
 * acknowledges it for them (interop 5.1). What their answer needs is kept
 * before the acknowledgement, so a crash between the two loses nothing: the
 * delivery then still waits, and opening it again keeps it once.
 */
export function createOpenDelivery(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor; opened: OpenedDeliveries; clock: Clock }): OpenDelivery {
  return async ({ caller, deliveryId }) => {
    const waiting = await waitingFor(deps, caller);
    if (!waiting.isOk) {
      return waiting;
    }
    const delivery = waiting.value.deliveries.find((each) => each.deliveryId === deliveryId);
    if (!delivery) {
      return refuse('NO_SUCH_DELIVERY', `No delivery ${deliveryId} waits for you: read your inbox again`);
    }
    await deps.opened.save({
      fleetId: caller.fleetId,
      shipId: waiting.value.crew.shipId,
      deliveryId: delivery.deliveryId,
      messageId: delivery.messageId,
      senderShipId: delivery.senderShipId,
      from: delivery.senderName,
      title: titleOf(delivery),
      openedAt: deps.clock.now(),
    });
    const acknowledged = await asPersonCrew(deps, { caller, run: (crew) => deps.door.ack(crew.crewToken, delivery.deliveryId) });
    if (!acknowledged.isOk) {
      return acknowledged;
    }
    return ok({ ...inboxEntryOf(delivery), contentType: delivery.contentType, payload: delivery.payload });
  };
}
