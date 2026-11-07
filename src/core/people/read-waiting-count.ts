import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import type { HeldDeliveries } from './held-deliveries.js';
import { itemsToDeal } from './items-to-deal.js';
import type { PersonCaller, PersonCrewError } from './person-crew.js';
import { isPlainMessage } from './plain-message.js';
import type { OpenedDeliveries, PersonCrews, PersonShipDoor } from './ports.js';
import { waitingFor } from './read-inbox.js';

/** What waits on a person: the questions and steps to deal with, and the plain messages not yet seen. */
export interface WaitingCount {
  readonly count: number;
}

export type ReadWaitingCount = (caller: PersonCaller) => Promise<Result<WaitingCount, PersonCrewError>>;

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
