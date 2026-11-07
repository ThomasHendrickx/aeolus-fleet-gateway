import type { FleetId } from '@aeolus-fleet/common';

import { isCounted, jobOf, type ItemJob } from './item-job.js';
import type { PersonCrewToken } from './person-crew.js';
import type { OpenedDeliveries, PersonDelivery } from './ports.js';
import { askingOf, staleOf, type Asking } from './stale-item.js';

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
