import { RECEIVE_MAX_UPPER_BOUND } from '@aeolus-fleet/common';

import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { inboxEntryOf, openedEntryOf, type InboxEntry } from './inbox-entry.js';
import { asPersonCrew, type PersonCaller, type PersonCrewError, type PersonCrewToken } from './person-crew.js';
import type { OpenedDeliveries, PersonCrews, PersonDelivery, PersonShipDoor } from './ports.js';
import { routingOf, type RoutingDefaults, type Routes } from './routing.js';

/** A person's inbox: how many deliveries wait and each of them, and the ones they opened and have not answered or done yet. */
export interface Inbox {
  readonly waiting: number;
  readonly deliveries: InboxEntry[];
  readonly opened: InboxEntry[];
}

export type ReadInbox = (caller: PersonCaller) => Promise<Result<Inbox, PersonCrewError>>;

/**
 * What waits for the caller's person ship: how many, and every one of them,
 * taken as received, the crew's own held ones again first, as many at a time
 * as one receive takes, each time past the ones taken already (aeolus-fleet
 * #1517). It stops once it took as many as wait, or once the fleet takes
 * nothing new, as a core that does not leave the taken ones out answers. It
 * asks how many wait first, so the person is never kept waiting while none
 * does.
 */
export async function waitingFor(
  deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor },
  caller: PersonCaller,
): Promise<Result<{ crew: PersonCrewToken; waiting: number; deliveries: PersonDelivery[] }, PersonCrewError>> {
  const counted = await asPersonCrew(deps, { caller, run: (crew) => deps.door.inbox(crew.crewToken) });
  if (!counted.isOk) {
    return counted;
  }
  const { waiting } = counted.value.value;
  let crew = counted.value.crew;
  let deliveries: PersonDelivery[] = [];
  while (deliveries.length < waiting) {
    const excluding = deliveries.map(({ deliveryId }) => deliveryId);
    const taken = await asPersonCrew(deps, { caller, run: (held) => deps.door.pushReceive(held.crewToken, { max: RECEIVE_MAX_UPPER_BOUND, ...(excluding.length === 0 ? {} : { excluding }) }) });
    if (!taken.isOk) {
      return taken;
    }
    crew = taken.value.crew;
    const isTaken = new Set<string>(excluding);
    const fresh = taken.value.value.filter(({ deliveryId }) => !isTaken.has(deliveryId));
    if (fresh.length === 0) {
      break;
    }
    deliveries = [...deliveries, ...fresh];
  }
  return ok({ crew, waiting, deliveries });
}

/**
 * Use case: a person reads their own person ship's inbox from a chat (Q20),
 * by titles only, in two groups (aeolus-fleet #1046): what waits, which the
 * gateway takes as the ship's crew, and what any client of the person opened
 * and they have not answered or done yet. A delivery the fleet still holds
 * as waiting, as when it did not take its acknowledgement, is listed waiting
 * only. A chat is a pull place (Bridge, CC7): it lists only the items of the
 * jobs on for it, every one not done whenever it arrived (CC20); what it
 * leaves out of what waits is left out of the count too.
 */
export function createReadInbox(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor; opened: OpenedDeliveries; routes: Routes; defaults: RoutingDefaults }): ReadInbox {
  return async (caller) => {
    const waiting = await waitingFor(deps, caller);
    if (!waiting.isOk) {
      return waiting;
    }
    const ship = { fleetId: caller.fleetId, shipId: waiting.value.crew.shipId };
    const routing = routingOf(await deps.routes.list(ship), deps.defaults);
    const isWaiting = new Set<string>(waiting.value.deliveries.map(({ deliveryId }) => deliveryId));
    const listed = waiting.value.deliveries.filter((delivery) => routing.isShowing('chat', delivery));
    const opened = await deps.opened.list(ship.fleetId, ship.shipId);
    return ok({
      waiting: waiting.value.waiting - (waiting.value.deliveries.length - listed.length),
      deliveries: listed.map(inboxEntryOf),
      // One opened before the gateway kept its content type is everything else.
      opened: opened.filter(({ deliveryId, contentType, sentAt }) => !isWaiting.has(deliveryId) && routing.isShowing('chat', { contentType: contentType ?? '', sentAt })).map(openedEntryOf),
    });
  };
}
