import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { asPersonCrew, type PersonCaller, type PersonCrewError } from './person-crew.js';
import type { OpenedDeliveries, PersonCrews, PersonShipDoor } from './ports.js';

/** What waits on a person now: how many deliveries wait, and how many they opened and have not answered or done yet. */
export interface InboxState {
  readonly waiting: number;
  readonly opened: number;
}

export type ReadInboxState = (caller: PersonCaller) => Promise<Result<InboxState, PersonCrewError>>;

/**
 * Use case: the state of a person's inbox, which every answer of their tools
 * carries beside its own (gateway #256, design Q3). Counts only: how many
 * wait is core's count, one call that takes no delivery, so reading it
 * confirms none; what is opened comes from the gateway's own store. The chat
 * reads the items themselves with aeolus_inbox.
 */
export function createReadInboxState(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: Pick<PersonShipDoor, 'inbox'>; opened: OpenedDeliveries }): ReadInboxState {
  return async (caller) => {
    const counted = await asPersonCrew(deps, { caller, run: (crew) => deps.door.inbox(crew.crewToken) });
    if (!counted.isOk) {
      return counted;
    }
    const opened = await deps.opened.list(caller.fleetId, counted.value.crew.shipId);
    return ok({ waiting: counted.value.value.waiting, opened: opened.length });
  };
}
