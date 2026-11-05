import { RECEIVE_MAX_UPPER_BOUND } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetRefusal } from '../connection/ports.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import type { HeldDeliveries } from './held-deliveries.js';
import { isMeetingNotice } from './item-job.js';
import { chatInboxEntryOf, chatOpenedEntryOf, type ChatInboxEntry } from './inbox-entry.js';
import { asPersonCrew, type PersonCaller, type PersonCrewError, type PersonCrewToken } from './person-crew.js';
import type { OpenedDeliveries, PersonCrews, PersonDelivery, PersonShipDoor } from './ports.js';
import { ownStepsInBridgeOnly, routingOf, type RoutingDefaults, type Routes } from './routing.js';

/** A person's inbox: how many deliveries wait and each of them, and the ones they opened and have not answered or done yet. */
export interface Inbox {
  readonly waiting: number;
  readonly deliveries: ChatInboxEntry[];
  readonly opened: ChatInboxEntry[];
}

export type ReadInbox = (caller: PersonCaller) => Promise<Result<Inbox, PersonCrewError>>;

/**
 * What waits for the caller's person ship: how many, and every one of them.
 * It asks how many wait first, so the person is never kept waiting while none
 * does, and a look is a read while the gateway holds as many as wait
 * (aeolus-fleet #1647). Else it receives past the ones it holds, as many at a
 * time as one receive takes, each time past the ones taken already
 * (aeolus-fleet #1517); holding more than wait, it receives every one again,
 * the crew's own held ones first. It stops once it took as many as wait, or
 * once the fleet takes nothing new, as a core that does not leave the taken
 * ones out answers.
 */
export async function waitingFor(
  deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor; held: HeldDeliveries },
  caller: PersonCaller,
): Promise<Result<{ crew: PersonCrewToken; waiting: number; deliveries: PersonDelivery[] }, PersonCrewError>> {
  const counted = await asPersonCrew(deps, { caller, run: (crew) => deps.door.inbox(crew.crewToken) });
  if (!counted.isOk) {
    return counted;
  }
  const { waiting } = counted.value.value;
  let crew = counted.value.crew;
  let deliveries = stillHeld(deps.held, { crewToken: crew.crewToken, waiting });
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
  deps.held.hold(crew.crewToken, deliveries);
  return ok({ crew, waiting, deliveries });
}

/** What the crew holds while it is no more than wait, so a receive reaches past it; else nothing, to receive every one again. */
function stillHeld(held: HeldDeliveries, look: { crewToken: string; waiting: number }): PersonDelivery[] {
  const { crewToken, waiting } = look;
  const kept = held.of(crewToken);
  return kept !== undefined && kept.length <= waiting ? [...kept] : [];
}

/**
 * What waits for a person ship, read with a crew token the gateway holds, as
 * its own workers read it with no person calling: taken as waitingFor takes
 * it, and refused as the fleet refuses, a crew that no longer works included.
 */
export async function waitingOn(deps: { door: Pick<PersonShipDoor, 'inbox' | 'pushReceive'>; held: HeldDeliveries }, crewToken: string): Promise<Result<PersonDelivery[], FleetRefusal>> {
  const { door, held } = deps;
  const counted = await door.inbox(crewToken);
  if (!counted.isOk) {
    return counted;
  }
  let deliveries = stillHeld(held, { crewToken, waiting: counted.value.waiting });
  while (deliveries.length < counted.value.waiting) {
    const excluding = deliveries.map(({ deliveryId }) => deliveryId);
    const taken = await door.pushReceive(crewToken, { max: RECEIVE_MAX_UPPER_BOUND, ...(excluding.length === 0 ? {} : { excluding }) });
    if (!taken.isOk) {
      return taken;
    }
    const isTaken = new Set<string>(excluding);
    const fresh = taken.value.filter(({ deliveryId }) => !isTaken.has(deliveryId));
    if (fresh.length === 0) {
      break;
    }
    deliveries = [...deliveries, ...fresh];
  }
  held.hold(crewToken, deliveries);
  return ok(deliveries);
}

/**
 * Use case: a person reads their own person ship's inbox from a chat (Q20),
 * by titles only, in two groups (aeolus-fleet #1046): what waits, which the
 * gateway takes as the ship's crew, and what any client of the person opened
 * and they have not answered or done yet. A delivery the fleet still holds
 * as waiting, as when it did not take its acknowledgement, is listed waiting
 * only. A chat is a pull place (Bridge, CC7): it lists only the items of the
 * jobs on for it, every one not done whenever it arrived (CC20); what it
 * leaves out of what waits is left out of the count too. The gateway's own
 * steps are never listed: they show in Bridge only (BH8). A meeting's added,
 * mic and ended notices are never listed either, nor counted: the record
 * keeps them.
 */
export function createReadInbox(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor; held: HeldDeliveries; opened: OpenedDeliveries; routes: Routes; defaults: RoutingDefaults; connections: Pick<ConnectionStore, 'binding'> }): ReadInbox {
  return async (caller) => {
    const waiting = await waitingFor(deps, caller);
    if (!waiting.isOk) {
      return waiting;
    }
    const ship = { fleetId: caller.fleetId, shipId: waiting.value.crew.shipId };
    const [routes, gateway] = await Promise.all([deps.routes.list(ship), deps.connections.binding(ship.fleetId)]);
    const routing = ownStepsInBridgeOnly(routingOf(routes, deps.defaults), gateway?.shipId);
    const isWaiting = new Set<string>(waiting.value.deliveries.map(({ deliveryId }) => deliveryId));
    const listed = waiting.value.deliveries.filter((delivery) => !isMeetingNotice(delivery.contentType) && routing.isShowing('chat', delivery));
    const opened = await deps.opened.list(ship.fleetId, ship.shipId);
    return ok({
      waiting: waiting.value.waiting - (waiting.value.deliveries.length - listed.length),
      deliveries: listed.map(chatInboxEntryOf),
      // One opened before the gateway kept its content type is everything else.
      opened: opened.filter(({ deliveryId, contentType, sentAt, senderShipId }) => !isWaiting.has(deliveryId) && !isMeetingNotice(contentType ?? '') && routing.isShowing('chat', { contentType: contentType ?? '', sentAt, senderShipId })).map(chatOpenedEntryOf),
    });
  };
}
