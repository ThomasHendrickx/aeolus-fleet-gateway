import type { Clock } from '../shared/clock.js';
import type { PartyStore } from '../parties/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { inboxEntryOf, titleOf, type InboxEntry } from './inbox-entry.js';
import type { OpenedDeliveries, PersonShipDoor } from './ports.js';
import { crewedPersonOf, INBOX_LIST_MAX, type PersonCaller } from './read-inbox.js';

/** A delivery as a person opens it: whole. */
export interface OpenedView extends InboxEntry {
  readonly contentType: string;
  readonly payload: string;
}

export type OpenDelivery = (input: { caller: PersonCaller; deliveryId: string }) => Promise<Result<OpenedView, DomainError<'NOT_A_PERSON' | 'NO_SUCH_DELIVERY' | 'FLEET_UNAVAILABLE'>>>;

/**
 * Use case: a person opens one delivery that waits for their ship (Q20).
 * Opening is their own act, so the gateway, as the ship's crew,
 * acknowledges it for them (interop 5.1). What their answer needs is kept
 * before the acknowledgement, so a crash between the two loses nothing: the
 * delivery then still waits, and opening it again keeps it once.
 */
export function createOpenDelivery(deps: { parties: PartyStore; door: PersonShipDoor; opened: OpenedDeliveries; clock: Clock }): OpenDelivery {
  return async ({ caller, deliveryId }) => {
    const person = await crewedPersonOf(deps.parties, caller);
    if (!person) {
      return refuse('NOT_A_PERSON', `The party ${caller.party} is no person's ship the gateway crews`);
    }
    const counted = await deps.door.inbox(person.crewToken);
    if (!counted.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not answer: ${counted.error.message}`);
    }
    const noSuchDelivery = refuse('NO_SUCH_DELIVERY', `No delivery ${deliveryId} waits for you: read your inbox again`);
    if (counted.value.waiting === 0) {
      return noSuchDelivery;
    }
    const taken = await deps.door.pushReceive(person.crewToken, { max: INBOX_LIST_MAX });
    if (!taken.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not answer: ${taken.error.message}`);
    }
    const delivery = taken.value.find((each) => each.deliveryId === deliveryId);
    if (!delivery) {
      return noSuchDelivery;
    }
    await deps.opened.save({
      fleetId: caller.fleetId,
      party: caller.party,
      deliveryId: delivery.deliveryId,
      messageId: delivery.messageId,
      senderShipId: delivery.senderShipId,
      from: delivery.senderName,
      title: titleOf(delivery),
      openedAt: deps.clock.now(),
    });
    const acknowledged = await deps.door.ack(person.crewToken, delivery.deliveryId);
    if (!acknowledged.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not take your opening: ${acknowledged.error.message}`);
    }
    return ok({ ...inboxEntryOf(delivery), contentType: delivery.contentType, payload: delivery.payload });
  };
}
