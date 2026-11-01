import { ALERT_CONTENT_TYPE, type DeliveryId } from '@aeolus-fleet/common';

import { refuse } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { askedQuestionOf, inboxEntryOf, type InboxEntry } from './inbox-entry.js';
import { essenceOf, jobOf, type ItemJob } from './item-job.js';
import type { ItemOutcome, ItemOutcomes, OutcomeKind, Place } from './item-outcome.js';
import { showingInOf, type PlacesDeps } from './item-places.js';
import { itemStateOf, type ItemState } from './item-state.js';
import { asPersonCrew, withOwnRefusal, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { PersonCrews, PersonShipDoor, RecordedPersonDelivery } from './ports.js';
import type { RoutingPlace } from './routing.js';
import { askingOf, staleOf, type Asking } from './stale-item.js';

/** A page of the record: what one screen shows (performance, a page that fits it). */
export const RECORD_PAGE_SIZE = 20;

/** The title of a sealed message the fleet cannot unseal now: its payload is empty (decision 0068). */
export const SEALED_TITLE = 'A sealed message: the fleet cannot unseal it now';

/**
 * What came of an item and where, as Done shows it: the answer's option by
 * its label and the note the person sent, where and when they saw it first,
 * and the title of the question or step that replaced it.
 */
export interface ShownOutcome {
  readonly place: Place;
  readonly kind: OutcomeKind;
  readonly option: number | null;
  /** The label of the option answered, as the question names it; none without an option, or one the question does not name. */
  readonly optionLabel: string | null;
  readonly note: string | null;
  readonly seen: { readonly place: Place; readonly at: string } | null;
  /** The title of what replaced it, when its replacement is on the same page of the record; none otherwise. */
  readonly replacementTitle: string | null;
  readonly at: string;
}

/**
 * An item of Done (Bridge, section 6): a delivery to the person ship by its
 * title, its job, an alert told from a notice, its state, the places
 * besides Bridge that showed it, what it says, so it opens whole, and what
 * came of it once kept.
 */
export interface RecordItem extends InboxEntry {
  readonly job: ItemJob;
  readonly isAlert: boolean;
  readonly state: ItemState;
  readonly places: readonly RoutingPlace[];
  readonly contentType: string;
  readonly payload: string;
  readonly outcome: ShownOutcome | null;
}

export interface RecordRead {
  readonly items: RecordItem[];
  readonly nextCursor: DeliveryId | null;
}

export type ReadRecord = (input: { caller: PersonCaller; cursor: DeliveryId | null }) => Promise<Result<RecordRead, PersonCrewError>>;

/** Whether a delivery only withdraws or replaces nothing new: a withdrawal, shown on the question or step it names, never an item of its own. */
function isWithdrawalOnly(asking: Asking): boolean {
  return (asking.withdrawnQuestionId !== null || asking.withdrawnStepId !== null) && asking.askedQuestionId === null && asking.stepId === null;
}

/**
 * Use case: a person reads Done (Bridge, CC4, CC12), their person ship's
 * record a page at a time, newest first, as core keeps it across the
 * ship's leases. Done holds only what is done (BH3); a withdrawal is never
 * an item of its own, as it shows on what it names. Each item says what
 * came of it and where once the gateway kept that, the places that showed
 * it, and what it says, so it reads back whole. Reading changes nothing.
 * When the fleet does not answer, the record cannot be read now; nothing
 * was acknowledged, so nothing is lost.
 */
export function createReadRecord(deps: PlacesDeps & { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor; outcomes: Pick<ItemOutcomes, 'findMany'> }): ReadRecord {
  return async ({ caller, cursor }) => {
    const read = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.record(crew.crewToken, { cursor, limit: RECORD_PAGE_SIZE })) });
    if (!read.isOk) {
      return read;
    }
    const page = read.value.value;
    if (!page.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The record cannot be read now: ${page.error.message}. Nothing is lost`);
    }
    const ship = { fleetId: caller.fleetId, shipId: read.value.crew.shipId };
    const asking = page.value.items.map(askingOf);
    const done = page.value.items.filter((delivery, index) => itemStateOf(delivery.state) === 'done' && !isWithdrawalOnly(asking[index] ?? askingOf(delivery)));
    const [kept, showingIn] = await Promise.all([deps.outcomes.findMany(ship.fleetId, { shipId: ship.shipId, deliveryIds: done.map(({ deliveryId }) => deliveryId) }), showingInOf(deps, ship)]);
    const outcomeOf = new Map(kept.map((outcome) => [outcome.deliveryId, outcome]));
    return ok({
      items: done.map((delivery) => ({ ...recordItemOf(delivery, { outcome: outcomeOf.get(delivery.deliveryId), asking }), places: showingIn(delivery) })),
      nextCursor: page.value.nextCursor,
    });
  };
}

function recordItemOf(delivery: RecordedPersonDelivery, of: { outcome: ItemOutcome | undefined; asking: readonly Asking[] }): Omit<RecordItem, 'places'> {
  const entry = inboxEntryOf(delivery);
  return {
    ...entry,
    title: delivery.isPayloadUnreadable ? SEALED_TITLE : entry.title,
    job: jobOf(delivery.contentType),
    isAlert: essenceOf(delivery.contentType) === ALERT_CONTENT_TYPE,
    state: itemStateOf(delivery.state),
    contentType: delivery.contentType,
    payload: delivery.payload,
    outcome: of.outcome === undefined ? null : shownOutcomeOf(delivery, { outcome: of.outcome, asking: of.asking }),
  };
}

function shownOutcomeOf(delivery: RecordedPersonDelivery, { outcome, asking }: { outcome: ItemOutcome; asking: readonly Asking[] }): ShownOutcome {
  const { option, seen } = outcome;
  const optionLabel = option === null ? undefined : askedQuestionOf(delivery)?.options.find(({ key }) => key === option)?.label;
  return {
    place: outcome.place,
    kind: outcome.kind,
    option,
    optionLabel: optionLabel ?? null,
    note: outcome.note,
    seen: seen === null ? null : { place: seen.place, at: seen.at.toISOString() },
    replacementTitle: staleOf(askingOf(delivery), asking)?.replacementTitle ?? null,
    at: outcome.at.toISOString(),
  };
}
