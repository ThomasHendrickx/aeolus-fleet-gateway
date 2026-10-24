import type { MeetingId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { inboxEntryOf, titleOf, type InboxEntry } from './inbox-entry.js';
import { asPersonCrew, withOwnRefusal, type PersonCaller, type PersonCrewError, type PersonCrewToken } from './person-crew.js';
import type { OpenedDeliveries, PersonCrews, PersonDelivery, PersonShipDoor } from './ports.js';
import { waitingFor } from './read-inbox.js';

/** A delivery as a person opens it: whole, with the meeting it belongs to, none outside a meeting. */
export interface OpenedView extends InboxEntry {
  readonly contentType: string;
  readonly payload: string;
  readonly meetingId: MeetingId | null;
}

type OpenError = PersonCrewError | DomainError<'NO_SUCH_DELIVERY'>;

export type OpenDelivery = (input: { caller: PersonCaller; deliveryId: string }) => Promise<Result<OpenedView, OpenError>>;

interface OpenDeps {
  crewPersonShip: CrewPersonShip;
  crews: PersonCrews;
  door: PersonShipDoor;
  opened: OpenedDeliveries;
  clock: Clock;
}

/**
 * Use case: a person opens one delivery that waits for their person ship
 * (Q20). Opening is their own act, so the gateway, as the ship's crew,
 * acknowledges it for them (interop 5.1). What their answer needs is kept
 * before the acknowledgement, so a crash between the two loses nothing: the
 * delivery then still waits, and opening it again keeps it once. One they
 * opened, from any client, opens again whole as the fleet reads it again,
 * never from a copy, until they answer it or are done (aeolus-fleet #1046).
 */
export function createOpenDelivery(deps: OpenDeps): OpenDelivery {
  return async ({ caller, deliveryId }) => {
    const waiting = await waitingFor(deps, caller);
    if (!waiting.isOk) {
      return waiting;
    }
    const delivery = waiting.value.deliveries.find((each) => each.deliveryId === deliveryId);
    if (!delivery) {
      return openedAgain(deps, { caller, crew: waiting.value.crew, deliveryId });
    }
    await deps.opened.save({
      fleetId: caller.fleetId,
      shipId: waiting.value.crew.shipId,
      deliveryId: delivery.deliveryId,
      messageId: delivery.messageId,
      senderShipId: delivery.senderShipId,
      from: delivery.senderName,
      title: titleOf(delivery),
      sentAt: delivery.sentAt,
      openedAt: deps.clock.now(),
    });
    const acknowledged = await asPersonCrew(deps, { caller, run: (crew) => deps.door.ack(crew.crewToken, delivery.deliveryId) });
    if (!acknowledged.isOk) {
      return acknowledged;
    }
    return ok(viewOf(delivery));
  };
}

/** A delivery the person opened before, as the fleet reads it again, acknowledging nothing. */
async function openedAgain(deps: OpenDeps, asked: { caller: PersonCaller; crew: PersonCrewToken; deliveryId: string }): Promise<Result<OpenedView, OpenError>> {
  const { caller, crew, deliveryId } = asked;
  const opened = await deps.opened.find(caller.fleetId, { shipId: crew.shipId, deliveryId });
  if (!opened) {
    return refuse('NO_SUCH_DELIVERY', `No delivery ${deliveryId} waits for you or is opened: read your inbox again`);
  }
  const reread = await asPersonCrew(deps, { caller, run: (held) => withOwnRefusal(deps.door.delivery(held.crewToken, opened.deliveryId)) });
  if (!reread.isOk) {
    return reread;
  }
  const delivery = reread.value.value;
  return delivery.isOk ? ok(viewOf(delivery.value)) : refuse('NO_SUCH_DELIVERY', `The fleet no longer holds it opened: ${delivery.error.message}`);
}

function viewOf(delivery: PersonDelivery): OpenedView {
  return { ...inboxEntryOf(delivery), contentType: delivery.contentType, payload: delivery.payload, meetingId: delivery.meetingId };
}
