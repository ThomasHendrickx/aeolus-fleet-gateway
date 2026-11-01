import { ALERT_CONTENT_TYPE, QUESTION_CONTENT_TYPE, type ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore } from '../connection/ports.js';
import { refuse } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { actInPlaceOf, type ActInPlace, type ActingItem, type OwnStepActionOf } from './act-in-place.js';
import type { BasketEntries, BasketEntry } from './basket.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { inboxEntryOf, openedEntryOf, type InboxEntry } from './inbox-entry.js';
import type { ItemOutcomes, Place } from './item-outcome.js';
import { essenceOf, isCounted, jobOf, type ItemJob } from './item-job.js';
import { itemStateOf, type ItemState } from './item-state.js';
import { asPersonCrew, withOwnRefusal, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { OpenedDeliveries, OpenedDelivery, PersonCrews, PersonShipDoor } from './ports.js';
import { waitingFor } from './read-inbox.js';
import { RECORD_PAGE_SIZE, SEALED_TITLE } from './read-record.js';
import { placesOf } from './item-places.js';
import { ownStepsInBridgeOnly, routingOf, type RoutingDefaults, type RoutingPlace, type Routes } from './routing.js';
import { askingOf, staleOf, type Asking, type Stale } from './stale-item.js';

/**
 * An item on Bridge home: by its title, with its job, an alert told from a
 * notice, new, seen and where, or done once a seen alert or notice, stale
 * once its asker withdrew or replaced the question or step it asks, the
 * answer to it in the basket, if any, the places besides Bridge that show
 * it, and what its row does in place.
 */
export interface HomeItem extends InboxEntry {
  readonly job: ItemJob;
  readonly isAlert: boolean;
  readonly state: ItemState;
  /** Where the person saw it; none while new, or for one seen before the gateway kept where. */
  readonly seenIn: Place | null;
  readonly stale: Stale | null;
  readonly inBasket: { readonly option: number | null; readonly note: string | null } | null;
  readonly places: readonly RoutingPlace[];
  readonly actInPlace: ActInPlace | null;
}

/** Bridge home: what waits on the person, decide and do, with its count, a stale question or step listed outside it; and the stay-aware feed, the unseen with the seen of the record's newest page, outside the count. */
export interface BridgeHome {
  readonly waiting: { readonly count: number; readonly items: HomeItem[] };
  readonly stayAware: HomeItem[];
}

export type ReadBridgeHome = (caller: PersonCaller) => Promise<Result<BridgeHome, PersonCrewError>>;

/**
 * The job of a delivery the person opened. One opened before the gateway
 * kept its content type was listed as waiting then, so it is one to decide.
 */
function openedJobOf(opened: OpenedDelivery): ItemJob {
  return opened.contentType === null ? 'decide' : jobOf(opened.contentType);
}

/** The answer in the basket to the question a delivery asks, by its delivery; none while the basket holds none. */
function inBasketOf(entries: readonly BasketEntry[]): (deliveryId: string) => HomeItem['inBasket'] {
  return (deliveryId) => {
    const entry = entries.find((each) => each.deliveryId === deliveryId);
    return entry === undefined ? null : { option: entry.option, note: entry.note };
  };
}

function newestFirst(a: HomeItem, b: HomeItem): number {
  return b.sentAt.localeCompare(a.sentAt);
}

/**
 * Use case: a person reads Bridge home (CC18). What waits is what the
 * gateway takes for their person ship as its crew, as their inbox does, and
 * what they opened and are not done with yet, kept to the jobs that wait on
 * them, decide and do (section 6), newest first, with their count. A
 * question or step its asker withdrew or replaced is listed stale, out of the count,
 * linked to its replacement; the withdrawal itself is not listed (CC11). The
 * alerts and notices that reached them are the stay-aware feed, outside the
 * count: those not seen, and those seen on the record's newest page, done
 * (CC16). Everything else is in the record. A
 * question whose answer is in the basket says so, and still waits until the
 * basket is sent (section 9, rule 1). Each item names where it was seen, the
 * places besides Bridge that show it, and what its row does in place; the
 * gateway's own step, told apart by its sender, the gateway's ship, is its
 * own action in the gateway's words.
 */
export function createReadBridgeHome(deps: {
  crewPersonShip: CrewPersonShip;
  crews: PersonCrews;
  door: PersonShipDoor;
  opened: OpenedDeliveries;
  entries: BasketEntries;
  outcomes: Pick<ItemOutcomes, 'findMany'>;
  connections: Pick<ConnectionStore, 'binding'>;
  routes: Routes;
  defaults: RoutingDefaults;
  ownStepActionOf: OwnStepActionOf;
  isEmailOffered: boolean;
  isWebPushOffered: boolean;
}): ReadBridgeHome {
  return async (caller) => {
    const waiting = await waitingFor(deps, caller);
    if (!waiting.isOk) {
      return waiting;
    }
    const read = await asPersonCrew(deps, { caller, run: (crew) => withOwnRefusal(deps.door.record(crew.crewToken, { cursor: null, limit: RECORD_PAGE_SIZE })) });
    if (!read.isOk) {
      return read;
    }
    const page = read.value.value;
    if (!page.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The record cannot be read now: ${page.error.message}. Nothing is lost`);
    }
    const ship = { fleetId: caller.fleetId, shipId: waiting.value.crew.shipId };
    const isTaken = new Set<string>(waiting.value.deliveries.map(({ deliveryId }) => deliveryId));
    const seenAware = page.value.items.filter((delivery) => !isTaken.has(delivery.deliveryId) && jobOf(delivery.contentType) === 'stay-aware' && itemStateOf(delivery.state) === 'done');
    const [opened, entries, routes, gateway, outcomes] = await Promise.all([
      deps.opened.list(ship.fleetId, ship.shipId),
      deps.entries.list(ship.fleetId, ship.shipId),
      deps.routes.list(ship),
      deps.connections.binding(ship.fleetId),
      deps.outcomes.findMany(ship.fleetId, { shipId: ship.shipId, deliveryIds: seenAware.map(({ deliveryId }) => deliveryId) }),
    ]);
    const asking: Asking[] = [...waiting.value.deliveries.map(askingOf), ...opened];
    const inBasket = inBasketOf(entries);
    const showingIn = placesOf(ownStepsInBridgeOnly(routingOf(routes, deps.defaults), gateway?.shipId), deps);
    const own = { gatewayShipId: gateway?.shipId, actionOf: deps.ownStepActionOf };
    /** What the row shows of an item besides its entry: an alert or not, the places that show it, and what it does in place. */
    const rowOf = (item: Omit<ActingItem, 'senderShipId' | 'pick' | 'stepLink'>, of: { contentType: string; sentAt: Date; senderShipId: ShipId; pick: number | null; stepLink: string | null }) => ({
      isAlert: essenceOf(of.contentType) === ALERT_CONTENT_TYPE,
      places: showingIn(of),
      actInPlace: actInPlaceOf({ ...item, senderShipId: of.senderShipId, pick: of.pick, stepLink: of.stepLink }, own),
    });
    const taken: HomeItem[] = waiting.value.deliveries.map((delivery) => {
      const item = { ...inboxEntryOf(delivery), job: jobOf(delivery.contentType), state: 'new' as const, stale: staleOf(askingOf(delivery), asking) };
      return { ...item, seenIn: null, inBasket: inBasket(delivery.deliveryId), ...rowOf(item, delivery) };
    });
    const seen: HomeItem[] = opened
      .filter(({ deliveryId }) => !isTaken.has(deliveryId))
      .map((delivery) => {
        const item = { ...openedEntryOf(delivery), job: openedJobOf(delivery), state: 'seen' as const, stale: staleOf(delivery, asking) };
        // One opened before the gateway kept its content type waited as a question.
        const contentType = delivery.contentType ?? QUESTION_CONTENT_TYPE;
        return { ...item, seenIn: delivery.openedIn, inBasket: inBasket(delivery.deliveryId), ...rowOf(item, { ...delivery, contentType, pick: null }) };
      });
    const seenInOf = new Map(outcomes.map(({ deliveryId, place }) => [deliveryId, place]));
    const seenFeed: HomeItem[] = seenAware.map((delivery) => {
      const entry = inboxEntryOf(delivery);
      const item = { ...entry, title: delivery.isPayloadUnreadable ? SEALED_TITLE : entry.title, job: 'stay-aware' as const, state: 'done' as const, stale: null };
      return { ...item, seenIn: seenInOf.get(delivery.deliveryId) ?? null, inBasket: null, ...rowOf(item, delivery) };
    });
    const items = [...taken, ...seen].filter(({ job }) => isCounted(job)).sort(newestFirst);
    return ok({ waiting: { count: items.filter(({ stale }) => stale === null).length, items }, stayAware: [...taken.filter(({ job }) => job === 'stay-aware'), ...seenFeed].sort(newestFirst) });
  };
}
