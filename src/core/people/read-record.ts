import type { DeliveryId } from '@aeolus-fleet/common';

import { refuse } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { inboxEntryOf, type InboxEntry } from './inbox-entry.js';
import { jobOf, type ItemJob } from './item-job.js';
import type { ItemOutcome, ItemOutcomes, OutcomeKind, Place } from './item-outcome.js';
import { itemStateOf, type ItemState } from './item-state.js';
import { asPersonCrew, withOwnRefusal, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { PersonCrews, PersonShipDoor, RecordedPersonDelivery } from './ports.js';

/** A page of the record: what one screen shows (performance, a page that fits it). */
export const RECORD_PAGE_SIZE = 20;

/** The title of a sealed message the fleet cannot unseal now: its payload is empty (decision 0068). */
export const SEALED_TITLE = 'A sealed message: the fleet cannot unseal it now';

/** What came of an item and where, as Bridge shows it. */
export interface ShownOutcome {
  readonly place: Place;
  readonly kind: OutcomeKind;
  readonly option: number | null;
  readonly at: string;
}

/** An item of the record (Bridge, section 6): a delivery to the person ship by its title, its job, its state and its outcome once kept. */
export interface RecordItem extends InboxEntry {
  readonly job: ItemJob;
  readonly state: ItemState;
  readonly outcome: ShownOutcome | null;
}

export interface RecordRead {
  readonly items: RecordItem[];
  readonly nextCursor: DeliveryId | null;
}

export type ReadRecord = (input: { caller: PersonCaller; cursor: DeliveryId | null }) => Promise<Result<RecordRead, PersonCrewError>>;

/**
 * Use case: a person reads their person ship's record (Bridge, CC12), a page
 * at a time, newest first, as core keeps it across the ship's leases: each
 * item with its job, its state, and what came of it and where once the
 * gateway kept that. Reading changes nothing. When the fleet does not
 * answer, the record cannot be read now; nothing was acknowledged, so
 * nothing is lost.
 */
export function createReadRecord(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor; outcomes: ItemOutcomes }): ReadRecord {
  return async ({ caller, cursor }) => {
    const read = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.record(crew.crewToken, { cursor, limit: RECORD_PAGE_SIZE })) });
    if (!read.isOk) {
      return read;
    }
    const page = read.value.value;
    if (!page.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The record cannot be read now: ${page.error.message}. Nothing is lost`);
    }
    const kept = await deps.outcomes.findMany(caller.fleetId, { shipId: read.value.crew.shipId, deliveryIds: page.value.items.map(({ deliveryId }) => deliveryId) });
    const outcomeOf = new Map(kept.map((outcome) => [outcome.deliveryId, outcome]));
    return ok({ items: page.value.items.map((delivery) => recordItemOf(delivery, outcomeOf.get(delivery.deliveryId))), nextCursor: page.value.nextCursor });
  };
}

function recordItemOf(delivery: RecordedPersonDelivery, outcome: ItemOutcome | undefined): RecordItem {
  const entry = inboxEntryOf(delivery);
  return {
    ...entry,
    title: delivery.isPayloadUnreadable ? SEALED_TITLE : entry.title,
    job: jobOf(delivery.contentType),
    state: itemStateOf(delivery.state),
    outcome: outcome === undefined ? null : { place: outcome.place, kind: outcome.kind, option: outcome.option, at: outcome.at.toISOString() },
  };
}
