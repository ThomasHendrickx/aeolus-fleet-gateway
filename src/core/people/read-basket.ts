import type { DeliveryId } from '@aeolus-fleet/common';

import { ok, type Result } from '../shared/result.js';
import { askingOfEntry, basketCountOf, standingOf, type BasketEntries, type BasketEntry, type BasketStanding } from './basket.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import type { ItemOutcomes } from './item-outcome.js';
import type { PersonCaller, PersonCrewError, PersonCrewToken } from './person-crew.js';
import type { OpenedDeliveries, OpenedDelivery, PersonCrews, PersonDelivery, PersonShipDoor } from './ports.js';
import { waitingFor } from './read-inbox.js';
import { askingOf as askingOfDelivery, staleOf, type Asking } from './stale-item.js';

/** An entry as the basket shows it: the question, its asker and when it asked, the option and the note, and what it stands as now. */
export interface BasketItem {
  readonly questionId: string;
  readonly deliveryId: DeliveryId;
  readonly from: string;
  readonly title: string;
  readonly sentAt: string;
  /** None for a note alone. */
  readonly option: number | null;
  readonly optionLabel: string | null;
  readonly note: string | null;
  readonly standing: BasketStanding;
}

/** The basket: its entries in the order added, how many will be sent, and how many answers Send would send now. */
export interface BasketView {
  /** What is or will be sent, as the basket's heading counts it. */
  readonly count: number;
  readonly toSend: number;
  readonly entries: BasketItem[];
}

export type ReadBasket = (caller: PersonCaller) => Promise<Result<BasketView, PersonCrewError>>;

export interface BasketDeps {
  crewPersonShip: CrewPersonShip;
  crews: PersonCrews;
  door: PersonShipDoor;
  opened: OpenedDeliveries;
  entries: BasketEntries;
  outcomes: ItemOutcomes;
}

/** The caller's basket as it stands now, with what waits and what they opened, from which each entry's question is known withdrawn or replaced. */
export interface StandingBasket {
  readonly crew: PersonCrewToken;
  readonly waiting: readonly PersonDelivery[];
  readonly opened: readonly OpenedDelivery[];
  readonly entries: readonly { readonly entry: BasketEntry; readonly standing: BasketStanding }[];
}

/**
 * Each entry of the caller's basket with what it stands as: what came of its
 * question, kept by the gateway wherever the person acted, and whether its
 * asker withdrew or replaced it, among what waits and what they opened.
 */
export async function standingBasketOf(deps: BasketDeps, caller: PersonCaller): Promise<Result<StandingBasket, PersonCrewError>> {
  const waiting = await waitingFor(deps, caller);
  if (!waiting.isOk) {
    return waiting;
  }
  const { crew, deliveries } = waiting.value;
  const [opened, entries] = await Promise.all([deps.opened.list(caller.fleetId, crew.shipId), deps.entries.list(caller.fleetId, crew.shipId)]);
  const outcomes = entries.length === 0 ? [] : await deps.outcomes.findMany(caller.fleetId, { shipId: crew.shipId, deliveryIds: entries.map(({ deliveryId }) => deliveryId) });
  const among: Asking[] = [...deliveries.map(askingOfDelivery), ...opened];
  return ok({
    crew,
    waiting: deliveries,
    opened,
    entries: entries.map((entry) => ({
      entry,
      standing: standingOf(entry, { outcome: outcomes.find(({ deliveryId }) => deliveryId === entry.deliveryId), stale: staleOf(askingOfEntry(entry), among) }),
    })),
  });
}

/**
 * Use case: a person opens their basket (section 9, rule 2): each entry in
 * the order added, with its question, asker, option and note, and what it
 * stands as, those sent kept until the next Put or Send; how many will be
 * sent; how many answers Send would send, the entries still waiting.
 */
export function createReadBasket(deps: BasketDeps): ReadBasket {
  return async (caller) => {
    const basket = await standingBasketOf(deps, caller);
    if (!basket.isOk) {
      return basket;
    }
    const entries = basket.value.entries.map(({ entry, standing }) => ({
      questionId: entry.questionId,
      deliveryId: entry.deliveryId,
      from: entry.from,
      title: entry.title,
      sentAt: entry.sentAt.toISOString(),
      option: entry.option,
      optionLabel: entry.optionLabel,
      note: entry.note,
      standing,
    }));
    return ok({ count: basketCountOf(entries.map(({ standing }) => standing)), toSend: entries.filter(({ standing }) => standing.kind === 'waiting').length, entries });
  };
}
