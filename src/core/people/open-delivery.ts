import type { MeetingId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { inboxEntryOf, titleOf, type InboxEntry } from './inbox-entry.js';
import { asPersonCrew, KEY_UNAVAILABLE, SEALED_MESSAGE, withOwnRefusal, type PersonCaller, type PersonCrewError, type PersonCrewToken } from './person-crew.js';
import { jobOf } from './item-job.js';
import { meetingNoticeSaid } from './meeting-notice.js';
import type { Place } from './item-outcome.js';
import { handledOf, type DealDeps } from './opened-of.js';
import type { OpenedDelivery, PersonDelivery } from './ports.js';
import { waitingFor } from './read-inbox.js';
import { askingOf, replacedBy, staleBy, withdrawerOf, type Asking, type Stale } from './stale-item.js';

/** A delivery as a person opens it: whole, with the meeting it belongs to, none outside a meeting, and stale once its asker withdrew or replaced the question or step it asks. */
export interface OpenedView extends InboxEntry {
  readonly contentType: string;
  readonly payload: string;
  readonly meetingId: MeetingId | null;
  /** The sentence a meeting notice says, in place of its payload; none for any other delivery. */
  readonly said: string | null;
  readonly stale: Stale | null;
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
 * handled for stays opened, and opening it again tries once more. So is
 * looking at a question or step its asker withdrew or replaced (Bridge, section 9):
 * it is shown stale and is done, withdrawn with its withdrawal, or replaced;
 * the replacement is a new item that still waits. Opening a replacement is
 * done with the question or step it replaces too.
 */
export function createOpenDelivery(deps: DealDeps): OpenDelivery {
  return async ({ caller, deliveryId, place }) => {
    const waiting = await waitingFor(deps, caller);
    if (!waiting.isOk) {
      return waiting;
    }
    const delivery = waiting.value.deliveries.find((each) => each.deliveryId === deliveryId);
    if (!delivery) {
      return openedAgain(deps, { caller, crew: waiting.value.crew, deliveryId, place, waiting: waiting.value.deliveries });
    }
    const kept = keptOf(deps, { caller, shipId: waiting.value.crew.shipId, delivery, place });
    const acknowledged = await seenNow(deps, { caller, kept });
    if (!acknowledged.isOk) {
      return acknowledged;
    }
    await seenIfAllItAsks(deps, { caller, opened: kept, place });
    const stale = await doneIfStale(deps, { caller, crew: waiting.value.crew, looked: kept, waiting: waiting.value.deliveries, place });
    return ok({ ...viewOf(delivery), stale });
  };
}

/** What the gateway keeps of a delivery the person opens: what their answer and their lists need, and where they opened it, never its payload. */
function keptOf(deps: DealDeps, opening: { caller: PersonCaller; shipId: OpenedDelivery['shipId']; delivery: PersonDelivery; place: Place }): OpenedDelivery {
  const { caller, shipId, delivery, place } = opening;
  return {
    fleetId: caller.fleetId,
    shipId,
    deliveryId: delivery.deliveryId,
    messageId: delivery.messageId,
    senderShipId: delivery.senderShipId,
    from: delivery.senderName,
    title: titleOf(delivery),
    contentType: delivery.contentType,
    askedQuestionId: delivery.askedQuestionId,
    withdrawnQuestionId: delivery.withdrawnQuestionId,
    stepId: delivery.stepId,
    withdrawnStepId: delivery.withdrawnStepId,
    stepLink: delivery.stepLink,
    // The gateway ending an item on its own is no sighting by the person.
    openedIn: place === 'gateway' ? null : place,
    sentAt: delivery.sentAt,
    openedAt: deps.clock.now(),
  };
}

/** Keeps it opened, then acknowledges it for the person and tells their pages their inbox changed. */
async function seenNow(deps: DealDeps, seen: { caller: PersonCaller; kept: OpenedDelivery }): Promise<Result<undefined, PersonCrewError>> {
  const { caller, kept } = seen;
  await deps.opened.save(kept);
  const acknowledged = await asPersonCrew(deps, { caller, run: (crew) => deps.door.ack(crew.crewToken, kept.deliveryId) });
  if (!acknowledged.isOk) {
    return acknowledged;
  }
  await deps.changes.tell({ fleetId: caller.fleetId, shipId: kept.shipId });
  return ok(undefined);
}

/**
 * The person looked at a delivery (Bridge, section 9): a question or step its asker
 * withdrew is done as withdrawn, and its withdrawal as seen; one replaced is
 * done as replaced. A replacement is done with the one it replaces.
 * What the fleet does not take now waits for the next look.
 */
export async function doneIfStale(deps: DealDeps, look: { caller: PersonCaller; crew: PersonCrewToken; looked: OpenedDelivery; waiting: readonly PersonDelivery[]; place: Place }): Promise<Stale | null> {
  const { caller, crew, looked, waiting, place } = look;
  const opened = await deps.opened.list(caller.fleetId, crew.shipId);
  const among: Asking[] = [...waiting.map(askingOf), ...opened.filter(({ deliveryId }) => deliveryId !== looked.deliveryId)];
  const withEach = { caller, crew, waiting, opened, place };
  const replaced = replacedBy(looked, among);
  if (replaced !== undefined) {
    await doneWith(deps, { ...withEach, deliveryId: replaced.deliveryId, kind: 'replaced' });
  }
  const withdrawer = withdrawerOf(looked, among);
  if (withdrawer === undefined) {
    return null;
  }
  const stale = staleBy(withdrawer);
  await handledOf(deps, { caller, delivery: looked, as: { place, kind: stale.kind, option: null } });
  if (stale.kind === 'withdrawn') {
    await doneWith(deps, { ...withEach, deliveryId: withdrawer.deliveryId, kind: 'seen' });
  }
  return stale;
}

/**
 * The gateway ends a question or step its asker withdrew or replaced, once it
 * left Bridge's lists (Bridge #240): as doneIfStale does when the person
 * looks at it, done by the gateway. One the person never opened is
 * acknowledged first, as no sighting of theirs. What the fleet does not take
 * now is tried again at the next read.
 */
export async function endStale(deps: DealDeps, ending: { caller: PersonCaller; crew: PersonCrewToken; deliveryId: string; waiting: readonly PersonDelivery[] }): Promise<void> {
  const { caller, crew, deliveryId, waiting } = ending;
  const place = 'gateway';
  let looked = await deps.opened.find(caller.fleetId, { shipId: crew.shipId, deliveryId });
  if (looked === undefined) {
    const delivery = waiting.find((each) => each.deliveryId === deliveryId);
    if (delivery === undefined) {
      return;
    }
    looked = keptOf(deps, { caller, shipId: crew.shipId, delivery, place });
    const acknowledged = await seenNow(deps, { caller, kept: looked });
    if (!acknowledged.isOk) {
      return;
    }
  }
  await doneIfStale(deps, { caller, crew, looked, waiting, place });
}

/** Reports a delivery the person did not open themselves handled, acknowledging it first while it still waits. */
async function doneWith(
  deps: DealDeps,
  done: { caller: PersonCaller; crew: PersonCrewToken; waiting: readonly PersonDelivery[]; opened: readonly OpenedDelivery[]; deliveryId: string; kind: 'withdrawn' | 'replaced' | 'seen'; place: Place },
): Promise<void> {
  const { caller, crew, waiting, opened, deliveryId, kind, place } = done;
  let kept = opened.find((each) => each.deliveryId === deliveryId);
  if (kept === undefined) {
    const delivery = waiting.find((each) => each.deliveryId === deliveryId);
    if (delivery === undefined) {
      return;
    }
    kept = keptOf(deps, { caller, shipId: crew.shipId, delivery, place });
    const acknowledged = await seenNow(deps, { caller, kept });
    if (!acknowledged.isOk) {
      return;
    }
  }
  await handledOf(deps, { caller, delivery: kept, as: { place, kind, option: null } });
}

/** Reports an alert or a notice handled once seen (CC16); any other delivery waits on the person still. */
async function seenIfAllItAsks(deps: DealDeps, seen: { caller: PersonCaller; opened: OpenedDelivery; place: Place }): Promise<void> {
  const { caller, opened, place } = seen;
  if (opened.contentType !== null && jobOf(opened.contentType) === 'stay-aware') {
    await handledOf(deps, { caller, delivery: opened, as: { place, kind: 'seen', option: null } });
  }
}

/** A delivery the person opened before, as the fleet reads it again, acknowledging nothing. */
async function openedAgain(deps: DealDeps, asked: { caller: PersonCaller; crew: PersonCrewToken; deliveryId: string; place: Place; waiting: readonly PersonDelivery[] }): Promise<Result<OpenedView, OpenError>> {
  const { caller, crew, deliveryId, place, waiting } = asked;
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
  const stale = await doneIfStale(deps, { caller, crew, looked: opened, waiting, place });
  return ok({ ...viewOf(delivery.value), stale });
}

function viewOf(delivery: PersonDelivery): Omit<OpenedView, 'stale'> {
  return { ...inboxEntryOf(delivery), contentType: delivery.contentType, payload: delivery.payload, meetingId: delivery.meetingId, said: meetingNoticeSaid({ ...delivery, from: delivery.senderName }) };
}
