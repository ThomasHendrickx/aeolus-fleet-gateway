import type { MeetingId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { inboxEntryOf, titleOf, type InboxEntry } from './inbox-entry.js';
import { asPersonCrew, KEY_UNAVAILABLE, SEALED_MESSAGE, withOwnRefusal, type PersonCaller, type PersonCrewError, type PersonCrewToken } from './person-crew.js';
import { jobOf } from './item-job.js';
import type { Place } from './item-outcome.js';
import { handledOf, type DealDeps } from './opened-of.js';
import type { OpenedDelivery, PersonDelivery } from './ports.js';
import { waitingFor } from './read-inbox.js';

/** A delivery as a person opens it: whole, with the meeting it belongs to, none outside a meeting. */
export interface OpenedView extends InboxEntry {
  readonly contentType: string;
  readonly payload: string;
  readonly meetingId: MeetingId | null;
}

type OpenError = PersonCrewError | DomainError<'NO_SUCH_DELIVERY'>;

export type OpenDelivery = (input: { caller: PersonCaller; deliveryId: string; place: Place }) => Promise<Result<OpenedView, OpenError>>;

/**
 * Use case: a person opens one delivery that waits for their person ship
 * (Q20). Opening is their own act, so the gateway, as the ship's crew,
 * acknowledges it for them (interop 5.1). What their answer needs is kept
 * before the acknowledgement, so a crash between the two loses nothing: the
 * delivery then still waits, and opening it again keeps it once. One they
 * opened, from any client, opens again whole as the fleet reads it again,
 * never from a copy, until they answer it or are done (aeolus-fleet #1046).
 * Once acknowledged, the person's pages are told their inbox changed.
 * Seeing an alert or a notice is all it asks (Bridge, CC16): it is reported
 * handled at once, seen where the person saw it; one the fleet did not take
 * handled for stays opened, and opening it again tries once more.
 */
export function createOpenDelivery(deps: DealDeps): OpenDelivery {
  return async ({ caller, deliveryId, place }) => {
    const waiting = await waitingFor(deps, caller);
    if (!waiting.isOk) {
      return waiting;
    }
    const delivery = waiting.value.deliveries.find((each) => each.deliveryId === deliveryId);
    if (!delivery) {
      return openedAgain(deps, { caller, crew: waiting.value.crew, deliveryId, place });
    }
    const kept: OpenedDelivery = {
      fleetId: caller.fleetId,
      shipId: waiting.value.crew.shipId,
      deliveryId: delivery.deliveryId,
      messageId: delivery.messageId,
      senderShipId: delivery.senderShipId,
      from: delivery.senderName,
      title: titleOf(delivery),
      contentType: delivery.contentType,
      askedQuestionId: delivery.askedQuestionId,
      withdrawnQuestionId: delivery.withdrawnQuestionId,
      sentAt: delivery.sentAt,
      openedAt: deps.clock.now(),
    };
    await deps.opened.save(kept);
    const acknowledged = await asPersonCrew(deps, { caller, run: (crew) => deps.door.ack(crew.crewToken, delivery.deliveryId) });
    if (!acknowledged.isOk) {
      return acknowledged;
    }
    await deps.changes.tell({ fleetId: caller.fleetId, shipId: waiting.value.crew.shipId });
    await seenIfAllItAsks(deps, { caller, opened: kept, place });
    return ok(viewOf(delivery));
  };
}

/** Reports an alert or a notice handled once seen (CC16); any other delivery waits on the person still. */
async function seenIfAllItAsks(deps: DealDeps, seen: { caller: PersonCaller; opened: OpenedDelivery; place: Place }): Promise<void> {
  const { caller, opened, place } = seen;
  if (opened.contentType !== null && jobOf(opened.contentType) === 'stay-aware') {
    await handledOf(deps, { caller, delivery: opened, as: { place, kind: 'seen', option: null } });
  }
}

/** A delivery the person opened before, as the fleet reads it again, acknowledging nothing. */
async function openedAgain(deps: DealDeps, asked: { caller: PersonCaller; crew: PersonCrewToken; deliveryId: string; place: Place }): Promise<Result<OpenedView, OpenError>> {
  const { caller, crew, deliveryId, place } = asked;
  const opened = await deps.opened.find(caller.fleetId, { shipId: crew.shipId, deliveryId });
  if (!opened) {
    return refuse('NO_SUCH_DELIVERY', `No delivery ${deliveryId} waits for you or is opened: read your inbox again`);
  }
  const reread = await asPersonCrew(deps, { caller, run: (held) => withOwnRefusal(deps.door.delivery(held.crewToken, opened.deliveryId)) });
  if (!reread.isOk) {
    return reread;
  }
  const delivery = reread.value.value;
  if (!delivery.isOk && delivery.error.code === KEY_UNAVAILABLE) {
    return refuse('KEY_UNAVAILABLE', SEALED_MESSAGE);
  }
  if (!delivery.isOk) {
    return refuse('NO_SUCH_DELIVERY', `The fleet no longer holds it opened: ${delivery.error.message}`);
  }
  await seenIfAllItAsks(deps, { caller, opened, place });
  return ok(viewOf(delivery.value));
}

function viewOf(delivery: PersonDelivery): OpenedView {
  return { ...inboxEntryOf(delivery), contentType: delivery.contentType, payload: delivery.payload, meetingId: delivery.meetingId };
}
