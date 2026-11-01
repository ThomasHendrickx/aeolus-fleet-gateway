import { ALERT_CONTENT_TYPE, QUESTION_CONTENT_TYPE } from '@aeolus-fleet/common';

import type { ConnectionStore } from '../connection/ports.js';
import { ok, type Result } from '../shared/result.js';
import { actInPlaceOf, type ActInPlace } from './act-in-place.js';
import type { BasketEntries, BasketEntry } from './basket.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { inboxEntryOf, openedEntryOf, type InboxEntry } from './inbox-entry.js';
import { essenceOf, isCounted, jobOf, type ItemJob } from './item-job.js';
import type { ItemState } from './item-state.js';
import type { PersonCaller, PersonCrewError } from './person-crew.js';
import type { OpenedDeliveries, OpenedDelivery, PersonCrews, PersonShipDoor } from './ports.js';
import { waitingFor } from './read-inbox.js';
import { ROUTING_PLACES, routingOf, type Routing, type RoutingDefaults, type RoutingPlace, type Routes } from './routing.js';
import { askingOf, staleOf, type Asking, type Stale } from './stale-item.js';
import { isOfferedPlace } from './turn-route.js';

/**
 * An item on Bridge home: by its title, with its job, an alert told from a
 * notice, new or seen, stale once its asker withdrew or replaced the question
 * or step it asks, the answer to it in the basket, if any, the places besides Bridge
 * that show it, and what its row does in place.
 */
export interface HomeItem extends InboxEntry {
  readonly job: ItemJob;
  readonly isAlert: boolean;
  readonly state: Exclude<ItemState, 'done'>;
  readonly stale: Stale | null;
  readonly inBasket: { readonly option: number | null; readonly note: string | null } | null;
  readonly places: readonly RoutingPlace[];
  readonly actInPlace: ActInPlace | null;
}

/** Bridge home: what waits on the person, decide and do, with its count, a stale question or step listed outside it; and the stay-aware feed, outside the count. */
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

/** The places besides Bridge that show an item, as routing per job has them and the gateway offers them, in routing's order. */
function placesOf(routing: Routing, offered: { isEmailOffered: boolean; isWebPushOffered: boolean }): (item: { contentType: string; sentAt: Date }) => RoutingPlace[] {
  return (item) => ROUTING_PLACES.filter((place) => isOfferedPlace(place, offered) && routing.isShowing(place, item));
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
 * linked to its replacement; the withdrawal itself is not listed (CC11, CC14). The
 * alerts and notices that reached them and they have not seen are the
 * stay-aware feed, outside the count. Everything else is in the record. A
 * question whose answer is in the basket says so, and still waits until the
 * basket is sent (section 9, rule 1). Each item names the places besides
 * Bridge that show it, and what its row does in place, the gateway's own
 * step told apart by its sender, the gateway's ship.
 */
export function createReadBridgeHome(deps: {
  crewPersonShip: CrewPersonShip;
  crews: PersonCrews;
  door: PersonShipDoor;
  opened: OpenedDeliveries;
  entries: BasketEntries;
  connections: Pick<ConnectionStore, 'binding'>;
  routes: Routes;
  defaults: RoutingDefaults;
  isEmailOffered: boolean;
  isWebPushOffered: boolean;
}): ReadBridgeHome {
  return async (caller) => {
    const waiting = await waitingFor(deps, caller);
    if (!waiting.isOk) {
      return waiting;
    }
    const ship = { fleetId: caller.fleetId, shipId: waiting.value.crew.shipId };
    const [opened, entries, routes, gateway] = await Promise.all([deps.opened.list(ship.fleetId, ship.shipId), deps.entries.list(ship.fleetId, ship.shipId), deps.routes.list(ship), deps.connections.binding(ship.fleetId)]);
    const asking: Asking[] = [...waiting.value.deliveries.map(askingOf), ...opened];
    const inBasket = inBasketOf(entries);
    const showingIn = placesOf(routingOf(routes, deps.defaults), deps);
    const taken: HomeItem[] = waiting.value.deliveries.map((delivery) => {
      const item = { ...inboxEntryOf(delivery), job: jobOf(delivery.contentType), state: 'new' as const, stale: staleOf(askingOf(delivery), asking) };
      return {
        ...item,
        isAlert: essenceOf(delivery.contentType) === ALERT_CONTENT_TYPE,
        inBasket: inBasket(delivery.deliveryId),
        places: showingIn(delivery),
        actInPlace: actInPlaceOf({ ...item, senderShipId: delivery.senderShipId, pick: delivery.pick, stepLink: delivery.stepLink }, gateway?.shipId),
      };
    });
    const isTaken = new Set<string>(taken.map(({ deliveryId }) => deliveryId));
    const seen: HomeItem[] = opened
      .filter(({ deliveryId }) => !isTaken.has(deliveryId))
      .map((delivery) => {
        const item = { ...openedEntryOf(delivery), job: openedJobOf(delivery), state: 'seen' as const, stale: staleOf(delivery, asking) };
        // One opened before the gateway kept its content type waited as a question.
        const contentType = delivery.contentType ?? QUESTION_CONTENT_TYPE;
        return {
          ...item,
          isAlert: essenceOf(contentType) === ALERT_CONTENT_TYPE,
          inBasket: inBasket(delivery.deliveryId),
          places: showingIn({ contentType, sentAt: delivery.sentAt }),
          actInPlace: actInPlaceOf({ ...item, senderShipId: delivery.senderShipId, pick: null, stepLink: delivery.stepLink }, gateway?.shipId),
        };
      });
    const items = [...taken, ...seen].filter(({ job }) => isCounted(job)).sort(newestFirst);
    return ok({ waiting: { count: items.filter(({ stale }) => stale === null).length, items }, stayAware: taken.filter(({ job }) => job === 'stay-aware').sort(newestFirst) });
  };
}
