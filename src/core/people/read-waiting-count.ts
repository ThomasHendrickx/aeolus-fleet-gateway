import type { FleetId } from '@aeolus-fleet/common';

import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import type { HeldDeliveries } from './held-deliveries.js';
import { isCounted, jobOf, type ItemJob } from './item-job.js';
import type { PersonCaller, PersonCrewError, PersonCrewToken } from './person-crew.js';
import { isPlainMessage } from './plain-message.js';
import type { OpenedDeliveries, PersonCrews, PersonDelivery, PersonShipDoor } from './ports.js';
import { waitingFor } from './read-inbox.js';
import { askingOf, staleOf, type Asking } from './stale-item.js';

/** What waits on a person: the questions and steps to deal with, and the plain messages not yet seen. */
export interface WaitingCount {
  readonly count: number;
}

export type ReadWaitingCount = (caller: PersonCaller) => Promise<Result<WaitingCount, PersonCrewError>>;

/** A question or step that waits on the person: who asked it, and its job. */
export interface ItemToDeal {
  readonly job: ItemJob;
  readonly asking: Asking;
}

/**
 * The questions and steps to deal with: those waiting and those the person
 * opened and has not dealt with, a stale one left out, a delivery both
 * waiting and opened once. It reads what the person ship has opened, never
 * the record.
 */
export async function itemsToDeal(deps: { opened: OpenedDeliveries }, waiting: { fleetId: FleetId; crew: PersonCrewToken; deliveries: readonly PersonDelivery[] }): Promise<ItemToDeal[]> {
  const opened = await deps.opened.list(waiting.fleetId, waiting.crew.shipId);
  const isWaiting = new Set<string>(waiting.deliveries.map(({ deliveryId }) => deliveryId));
  const openedNow = opened.filter(({ deliveryId }) => !isWaiting.has(deliveryId));
  const asking: Asking[] = [...waiting.deliveries.map(askingOf), ...opened];
  return [
    ...waiting.deliveries.map((delivery) => ({ job: jobOf(delivery.contentType), asking: askingOf(delivery) })),
    // One opened before the gateway kept its content type waited as a question.
    ...openedNow.map((delivery) => ({ job: delivery.contentType === null ? ('decide' as const) : jobOf(delivery.contentType), asking: delivery })),
  ].filter(({ job, asking: each }) => isCounted(job) && staleOf(each, asking) === null);
}

/**
 * Use case: the count behind the app's Home indicator and icon badge. It is
 * Bridge home's count of what waits, decide and do, a stale question or step
 * left out, plus the plain messages still waiting, which the person has not
 * seen: one they opened is seen. Alerts, notices and a meeting's notices are
 * left out. It reads what waits for the person ship (one count while none
 * does) and what the person opened, never the record, so what it costs
 * follows what waits, not the history.
 */
export function createReadWaitingCount(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor; held: HeldDeliveries; opened: OpenedDeliveries }): ReadWaitingCount {
  return async (caller) => {
    const waiting = await waitingFor(deps, caller);
    if (!waiting.isOk) {
      return waiting;
    }
    const toDeal = await itemsToDeal(deps, { fleetId: caller.fleetId, ...waiting.value });
    const unseenMessages = waiting.value.deliveries.filter(({ contentType }) => isPlainMessage(contentType));
    return ok({ count: toDeal.length + unseenMessages.length });
  };
}
