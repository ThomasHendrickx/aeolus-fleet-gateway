import { ok, type Result } from '../shared/result.js';
import type { BasketEntries, BasketEntry } from './basket.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { inboxEntryOf, openedEntryOf, type InboxEntry } from './inbox-entry.js';
import { isCounted, jobOf, type ItemJob } from './item-job.js';
import type { ItemState } from './item-state.js';
import type { PersonCaller, PersonCrewError } from './person-crew.js';
import type { OpenedDeliveries, OpenedDelivery, PersonCrews, PersonShipDoor } from './ports.js';
import { waitingFor } from './read-inbox.js';
import { staleOf, type Asking, type Stale } from './stale-item.js';

/** An item on Bridge home: by its title, with its job, new or seen, stale once its asker withdrew or replaced the question or step it asks, and the answer to it in the basket, if any. */
export interface HomeItem extends InboxEntry {
  readonly job: ItemJob;
  readonly state: Exclude<ItemState, 'done'>;
  readonly stale: Stale | null;
  readonly inBasket: { readonly option: number | null; readonly note: string | null } | null;
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
 * basket is sent (section 9, rule 1).
 */
export function createReadBridgeHome(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor; opened: OpenedDeliveries; entries: BasketEntries }): ReadBridgeHome {
  return async (caller) => {
    const waiting = await waitingFor(deps, caller);
    if (!waiting.isOk) {
      return waiting;
    }
    const [opened, entries] = await Promise.all([deps.opened.list(caller.fleetId, waiting.value.crew.shipId), deps.entries.list(caller.fleetId, waiting.value.crew.shipId)]);
    const asking: Asking[] = [...waiting.value.deliveries, ...opened];
    const inBasket = inBasketOf(entries);
    const taken: HomeItem[] = waiting.value.deliveries.map((delivery) => ({ ...inboxEntryOf(delivery), job: jobOf(delivery.contentType), state: 'new', stale: staleOf(delivery, asking), inBasket: inBasket(delivery.deliveryId) }));
    const isTaken = new Set<string>(taken.map(({ deliveryId }) => deliveryId));
    const seen: HomeItem[] = opened
      .filter(({ deliveryId }) => !isTaken.has(deliveryId))
      .map((delivery) => ({ ...openedEntryOf(delivery), job: openedJobOf(delivery), state: 'seen', stale: staleOf(delivery, asking), inBasket: inBasket(delivery.deliveryId) }));
    const items = [...taken, ...seen].filter(({ job }) => isCounted(job)).sort(newestFirst);
    return ok({ waiting: { count: items.filter(({ stale }) => stale === null).length, items }, stayAware: taken.filter(({ job }) => job === 'stay-aware').sort(newestFirst) });
  };
}
