import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import { inboxEntryOf, type InboxEntry } from './inbox-entry.js';
import { asPersonCrew, type PersonCaller, type PersonCrewError, type PersonCrewToken } from './person-crew.js';
import type { PersonCrews, PersonDelivery, PersonShipDoor } from './ports.js';

/** The most deliveries an inbox lists at once: as many as one receive takes. */
export const INBOX_LIST_MAX = 10;

export type ReadInbox = (caller: PersonCaller) => Promise<Result<{ waiting: number; deliveries: InboxEntry[] }, PersonCrewError>>;

/**
 * What waits for the caller's person ship: how many, and up to the most an
 * inbox lists, taken as received, the crew's own held ones again first. It
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
  const { crew, value } = counted.value;
  if (value.waiting === 0) {
    return ok({ crew, waiting: 0, deliveries: [] });
  }
  const taken = await asPersonCrew(deps, { caller, run: (held) => deps.door.pushReceive(held.crewToken, { max: INBOX_LIST_MAX }) });
  return taken.isOk ? ok({ crew: taken.value.crew, waiting: value.waiting, deliveries: taken.value.value }) : taken;
}

/**
 * Use case: a person reads their own person ship's inbox (Q20): what waits,
 * by titles only. The gateway takes the waiting deliveries as the ship's
 * crew, so nothing is stored in the gateway, and a delivery listed is listed
 * again until the person deals with it.
 */
export function createReadInbox(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor }): ReadInbox {
  return async (caller) => {
    const waiting = await waitingFor(deps, caller);
    return waiting.isOk ? ok({ waiting: waiting.value.waiting, deliveries: waiting.value.deliveries.map(inboxEntryOf) }) : waiting;
  };
}
