import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { Sleep } from '../mcp-out/run-party.js';
import type { Clock } from '../shared/clock.js';
import { isEndedCrew } from './person-crew.js';
import type { InboxChanges, PersonCrews, PersonShipDoor } from './ports.js';
import type { WakePerson } from './wake-person.js';

/**
 * Why a waiter ended: the ship's crew no longer works and was dropped, the
 * gateway holds no crew for the ship, or it was stopped.
 */
export type WaiterEnd = { readonly reason: 'crewEnded' } | { readonly reason: 'noCrew' } | { readonly reason: 'stopped' };

export type WaitOnPersonShip = (ship: { fleetId: FleetId; shipId: ShipId }, signal: AbortSignal) => Promise<WaiterEnd>;

/**
 * Use case: the waiter of a person ship the gateway crews (wake a person,
 * W5, W7). It looks once at the ship's inbox, then asks the fleet to wait
 * while the count is the one it knows, and tells the person's pages at its
 * first look and each time the count changed. It reads the crew it holds anew for every call, so
 * a ship crewed again goes on with its new crew; a crew that no longer works
 * is dropped, so the next sign-in crews again, and the waiter ends. While
 * the fleet does not answer, it waits longer each time.
 *
 * Each time the count rose, and at its first look while anything waits, it
 * wakes the person (W3): a wake whose channel's window is still open is
 * looked at again once it ended, and one that failed is tried again, later
 * each time. The fleet's wait is short, so it looks then at the first answer
 * after that time.
 */
export function createWaitOnPersonShip(deps: {
  crews: PersonCrews;
  door: Pick<PersonShipDoor, 'inbox'>;
  changes: InboxChanges;
  sleep: Sleep;
  /** How long to wait after each refusal in a row; the last repeats. */
  againWaitsMs: readonly number[];
  wake: WakePerson;
  clock: Clock;
  /** When to try a wake again after each failure in a row; the last repeats. */
  wakeAgainWaitsMs: readonly number[];
}): WaitOnPersonShip {
  return async (ship, signal) => {
    const { fleetId, shipId } = ship;
    let knownWaiting: number | undefined;
    let refusedInARow = 0;
    let wakesFailedInARow = 0;
    /** When to wake again though the count did not rise: a window ended, or a failed wake is tried again. */
    let wakeAgainAt: Date | null = null;
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
      // The first look tells too: a page may have read the inbox before the waiter started.
      if (waiting !== knownWaiting) {
        await deps.changes.tell(ship);
      }
      const hasRisen = waiting > (knownWaiting ?? 0);
      knownWaiting = waiting;
      const now = deps.clock.now();
      if (!hasRisen && (wakeAgainAt === null || now < wakeAgainAt)) {
        continue;
      }
      const woken = await deps.wake(ship, crew.crewToken);
      switch (woken.kind) {
        case 'settled':
          wakeAgainAt = null;
          wakesFailedInARow = 0;
          break;
        case 'windowOpen':
          wakeAgainAt = woken.endsAt;
          wakesFailedInARow = 0;
          break;
        case 'failed':
          wakeAgainAt = new Date(now.getTime() + (deps.wakeAgainWaitsMs[Math.min(wakesFailedInARow, deps.wakeAgainWaitsMs.length - 1)] ?? 0));
          wakesFailedInARow += 1;
          break;
      }
    }
    return { reason: 'stopped' };
  };
}
