import type { FleetId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import type { HeldDeliveries } from './held-deliveries.js';
import { itemsToDeal } from './items-to-deal.js';
import type { PersonCaller, PersonCrewError, PersonCrewToken } from './person-crew.js';
import { isPlainMessage } from './plain-message.js';
import type { OpenedDeliveries, PersonCrews, PersonDelivery, PersonShip, PersonShipDoor } from './ports.js';
import { waitingFor, waitingOn } from './read-inbox.js';

/** What waits on a person: the questions and steps to deal with, and the plain messages not yet seen. */
export interface WaitingCount {
  readonly count: number;
}

export type ReadWaitingCount = (caller: PersonCaller) => Promise<Result<WaitingCount, PersonCrewError>>;

/** The same count for a person ship, read with the crew token the gateway holds, as its wakes say it with no person calling. */
export type CountWaitingOn = (ship: PersonShip, crewToken: string) => Promise<Result<number, FleetRefusal>>;

/** The questions and steps to deal with, plus the plain messages waiting, which the person has not seen. */
async function countOf(deps: { opened: OpenedDeliveries }, waiting: { fleetId: FleetId; crew: PersonCrewToken; deliveries: readonly PersonDelivery[] }): Promise<number> {
  const toDeal = await itemsToDeal(deps, waiting);
  const unseenMessages = waiting.deliveries.filter(({ contentType }) => isPlainMessage(contentType));
  return toDeal.length + unseenMessages.length;
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
    return ok({ count: await countOf(deps, { fleetId: caller.fleetId, ...waiting.value }) });
  };
}

/** The count of what waits on a person ship, read as readWaitingCount reads it, with the crew token the gateway holds: refused as the fleet refuses. */
export function createCountWaitingOn(deps: { door: Pick<PersonShipDoor, 'inbox' | 'pushReceive'>; held: HeldDeliveries; opened: OpenedDeliveries }): CountWaitingOn {
  return async (ship, crewToken) => {
    const deliveries = await waitingOn(deps, crewToken);
    if (!deliveries.isOk) {
      return deliveries;
    }
    return ok(await countOf(deps, { fleetId: ship.fleetId, crew: { shipId: ship.shipId, crewToken }, deliveries: deliveries.value }));
  };
}
