import type { DeliveryId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import type { HeldDeliveries } from './held-deliveries.js';
import { inboxEntryOf } from './inbox-entry.js';
import { meetingNoticeSaid } from './meeting-notice.js';
import type { OpenedView } from './open-delivery.js';
import { asPersonCrew, KEY_UNAVAILABLE, SEALED_MESSAGE, withOwnRefusal, type PersonCaller, type PersonCrewError, type PersonCrewToken } from './person-crew.js';
import type { OpenedDeliveries, PersonCrews, PersonDelivery, PersonShipDoor } from './ports.js';
import { waitingFor } from './read-inbox.js';
import { RECORD_PAGE_SIZE } from './read-record.js';
import { askingOf, staleOf, type Stale } from './stale-item.js';

type ReadItemError = PersonCrewError | DomainError<'NO_SUCH_DELIVERY'>;

export type ReadItem = (input: { caller: PersonCaller; deliveryId: DeliveryId }) => Promise<Result<OpenedView, ReadItemError>>;

interface ReadItemDeps {
  crewPersonShip: CrewPersonShip;
  crews: PersonCrews;
  door: PersonShipDoor;
  held: HeldDeliveries;
  opened: Pick<OpenedDeliveries, 'list'>;
}

/**
 * Use case: a person's client reads one item of their person ship whole by its
 * delivery id, in any state, as opening gives it, and acknowledges nothing
 * and keeps nothing. A waiting one is read from what waits, one they
 * acknowledged and are not done with is read again from the fleet, and a
 * done one is found in the ship's record, newest first. A delivery of
 * another ship is none of these, so it is refused as no such delivery. A
 * sealed message the fleet cannot unseal now is refused, as opening refuses it.
 */
export function createReadItem(deps: ReadItemDeps): ReadItem {
  return async ({ caller, deliveryId }) => {
    const waiting = await waitingFor(deps, caller);
    if (!waiting.isOk) {
      return waiting;
    }
    const { crew, deliveries } = waiting.value;
    const delivery = deliveries.find((each) => each.deliveryId === deliveryId);
    const found = delivery === undefined ? await readFromFleet(deps, { caller, deliveryId }) : ok(delivery);
    if (!found.isOk) {
      return found;
    }
    const stale = await staleFor(deps, { caller, crew, delivery: found.value, waiting: deliveries });
    return ok({ ...inboxEntryOf(found.value), contentType: found.value.contentType, payload: found.value.payload, meetingId: found.value.meetingId, said: meetingNoticeSaid({ ...found.value, from: found.value.senderName }), stale });
  };
}

/** An item that no more waits: the person acknowledged it and is not done, so the fleet reads it again, or it is done, so the record holds it. */
async function readFromFleet(deps: ReadItemDeps, asked: { caller: PersonCaller; deliveryId: DeliveryId }): Promise<Result<PersonDelivery, ReadItemError>> {
  const { caller, deliveryId } = asked;
  const reread = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.delivery(crew.crewToken, deliveryId)) });
  if (!reread.isOk) {
    return reread;
  }
  const delivery = reread.value.value;
  if (delivery.isOk) {
    return ok(delivery.value);
  }
  if (delivery.error.code === KEY_UNAVAILABLE) {
    return refuse('KEY_UNAVAILABLE', SEALED_MESSAGE);
  }
  return inRecord(deps, asked);
}

/** Looks through the record, newest first, until the delivery or the ids older than it. */
async function inRecord(deps: ReadItemDeps, asked: { caller: PersonCaller; deliveryId: DeliveryId; cursor?: DeliveryId | null }): Promise<Result<PersonDelivery, ReadItemError>> {
  const { caller, deliveryId, cursor = null } = asked;
  const read = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.record(crew.crewToken, { cursor, limit: RECORD_PAGE_SIZE })) });
  if (!read.isOk) {
    return read;
  }
  const page = read.value.value;
  if (!page.isOk) {
    return refuse('FLEET_UNAVAILABLE', `The item cannot be read now: ${page.error.message}. Nothing is lost`);
  }
  const recorded = page.value.items.find((each) => each.deliveryId === deliveryId);
  if (recorded !== undefined) {
    return recorded.isPayloadUnreadable ? refuse('KEY_UNAVAILABLE', SEALED_MESSAGE) : ok(recorded);
  }
  const oldest = page.value.items.at(-1)?.deliveryId;
  if (oldest === undefined || oldest < deliveryId || page.value.nextCursor === null) {
    return refuse('NO_SUCH_DELIVERY', `No delivery ${deliveryId} of your person ship waits, is opened or is done: read your inbox again`);
  }
  return inRecord(deps, { ...asked, cursor: page.value.nextCursor });
}

/** Whether its asker withdrew or replaced the question or step it asks, among what waits and what the person opened; only told, never ended. */
async function staleFor(deps: ReadItemDeps, look: { caller: PersonCaller; crew: PersonCrewToken; delivery: PersonDelivery; waiting: readonly PersonDelivery[] }): Promise<Stale | null> {
  const { caller, crew, delivery, waiting } = look;
  const opened = await deps.opened.list(caller.fleetId, crew.shipId);
  return staleOf(askingOf(delivery), [...waiting.map(askingOf), ...opened]);
}
