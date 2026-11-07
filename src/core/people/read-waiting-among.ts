import type { ShipId } from '@aeolus-fleet/common';

import { ok, type Result } from '../shared/result.js';
import type { CrewPersonShip } from './crew-person-ship.js';
import type { HeldDeliveries } from './held-deliveries.js';
import { itemsToDeal } from './items-to-deal.js';
import type { PersonCaller, PersonCrewError } from './person-crew.js';
import type { OpenedDeliveries, PersonCrews, PersonShipDoor } from './ports.js';
import { waitingFor } from './read-inbox.js';

/** How many questions and steps from one ship wait on the person. */
export interface WaitingFromShip {
  readonly shipId: ShipId;
  readonly count: number;
}

export type ReadWaitingAmong = (read: { caller: PersonCaller; shipIds: readonly ShipId[] }) => Promise<Result<WaitingFromShip[], PersonCrewError>>;

/**
 * Use case: the number on each row of the app's list of conversations. For the
 * ships a page shows, how many questions and steps from each wait on the
 * person, by the rule of the waiting count (a stale one left out, one opened
 * and not dealt with kept, plain messages, alerts and notices left out). A
 * ship with none waiting is left out of the answer. It reads what waits for
 * the person ship and what the person opened, never the record, so what it
 * costs follows what waits, not the history.
 */
export function createReadWaitingAmong(deps: { crewPersonShip: CrewPersonShip; crews: PersonCrews; door: PersonShipDoor; held: HeldDeliveries; opened: OpenedDeliveries }): ReadWaitingAmong {
  return async ({ caller, shipIds }) => {
    const waiting = await waitingFor(deps, caller);
    if (!waiting.isOk) {
      return waiting;
    }
    const toDeal = await itemsToDeal(deps, { fleetId: caller.fleetId, ...waiting.value });
    const counts = new Map<ShipId, number>();
    for (const { asking } of toDeal) {
      counts.set(asking.senderShipId, (counts.get(asking.senderShipId) ?? 0) + 1);
    }
    return ok([...new Set(shipIds)].flatMap((shipId) => ((counts.get(shipId) ?? 0) === 0 ? [] : [{ shipId, count: counts.get(shipId) ?? 0 }])));
  };
}
