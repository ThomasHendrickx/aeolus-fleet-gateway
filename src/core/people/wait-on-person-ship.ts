import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { Sleep } from '../mcp-out/run-party.js';
import { isEndedCrew } from './person-crew.js';
import type { InboxChanges, PersonCrews, PersonShipDoor } from './ports.js';

/**
 * Why a waiter ended: the ship's crew no longer works and was dropped, the
 * gateway holds no crew for the ship, or it was stopped.
 */
export type WaiterEnd = { readonly reason: 'crewEnded' } | { readonly reason: 'noCrew' } | { readonly reason: 'stopped' };

export type WaitOnPersonShip = (ship: { fleetId: FleetId; shipId: ShipId }, signal: AbortSignal) => Promise<WaiterEnd>;

/**
 * Use case: the waiter of a person ship the gateway crews (wake a person,
 * W5, W7). It looks once at the ship's inbox, then asks the fleet to wait
 * while the count is the one it knows, and tells the person's pages each
 * time the count changed. It reads the crew it holds anew for every call, so
 * a ship crewed again goes on with its new crew; a crew that no longer works
 * is dropped, so the next sign-in crews again, and the waiter ends. While
 * the fleet does not answer, it waits longer each time.
 */
export function createWaitOnPersonShip(deps: {
  crews: PersonCrews;
  door: Pick<PersonShipDoor, 'inbox'>;
  changes: InboxChanges;
  sleep: Sleep;
  /** How long to wait after each refusal in a row; the last repeats. */
  againWaitsMs: readonly number[];
}): WaitOnPersonShip {
  return async (ship, signal) => {
    const { fleetId, shipId } = ship;
    let knownWaiting: number | undefined;
    let refusedInARow = 0;
    // Read as a call, as the signal aborts between awaits.
    const isStopped = (): boolean => signal.aborted;
    while (!isStopped()) {
      const crew = await deps.crews.find(fleetId, shipId);
      if (crew === undefined) {
        return { reason: 'noCrew' };
      }
      const answered = await deps.door.inbox(crew.crewToken, knownWaiting === undefined ? undefined : { knownWaiting, signal });
      if (isStopped()) {
        break;
      }
      if (!answered.isOk) {
        if (isEndedCrew(answered.error)) {
          const held = await deps.crews.find(fleetId, shipId);
          if (held?.crewToken === crew.crewToken) {
            await deps.crews.drop(fleetId, shipId);
            return { reason: 'crewEnded' };
          }
          continue;
        }
        await deps.sleep(deps.againWaitsMs[Math.min(refusedInARow, deps.againWaitsMs.length - 1)] ?? 0, signal);
        refusedInARow += 1;
        continue;
      }
      refusedInARow = 0;
      const { waiting } = answered.value;
      if (knownWaiting !== undefined && waiting !== knownWaiting) {
        await deps.changes.tell(ship);
      }
      knownWaiting = waiting;
    }
    return { reason: 'stopped' };
  };
}
