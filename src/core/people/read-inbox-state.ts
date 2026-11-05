import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import type { HeldDeliveries } from './held-deliveries.js';
import { isMeetingNotice } from './item-job.js';
import type { PersonCaller, PersonCrewError } from './person-crew.js';
import type { OpenedDeliveries, PersonCrews, PersonShipDoor } from './ports.js';
import { waitingFor } from './read-inbox.js';

/** What waits on a person now: how many deliveries wait, and how many they opened and have not answered or done yet. */
export interface InboxState {
  readonly waiting: number;
  readonly opened: number;
}

export type ReadInboxState = (caller: PersonCaller) => Promise<Result<InboxState, PersonCrewError>>;

/**
 * Use case: the state of a person's inbox, which every answer of their tools
 * carries beside its own (gateway #256, design Q3). Counts only, and the
 * counts aeolus_inbox gives: a meeting's added, mic and ended notices are in
 * neither. While none waits it asks core how many wait, one call that takes
 * no delivery; else it reads what waits as aeolus_inbox does, to leave the
 * notices out, which confirms none. What is opened comes from the gateway's
 * own store. The chat reads the items themselves with aeolus_inbox.
 */
export function createReadInboxState(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor; held: HeldDeliveries; opened: OpenedDeliveries }): ReadInboxState {
  return async (caller) => {
    const waiting = await waitingFor(deps, caller);
    if (!waiting.isOk) {
      return waiting;
    }
    const noticesWaiting = waiting.value.deliveries.filter(({ contentType }) => isMeetingNotice(contentType)).length;
    const opened = await deps.opened.list(caller.fleetId, waiting.value.crew.shipId);
    return ok({ waiting: waiting.value.waiting - noticesWaiting, opened: opened.filter(({ contentType }) => !isMeetingNotice(contentType ?? '')).length });
  };
}
