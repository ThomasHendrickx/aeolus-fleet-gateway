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
 * first look and each time the count changed. When something waits at its
 * first look, and each time the count rose, it wakes the person (W3); a
 * wake a window held back is asked for again once the window ends, and one
 * that failed after a wait, longer each time. It reads the crew it holds anew for every call, so
 * a ship crewed again goes on with its new crew; a crew that no longer works
 * is dropped, so the next sign-in crews again, and the waiter ends. While
 * the fleet does not answer, it waits longer each time.
 */
export function createWaitOnPersonShip(deps: {
  crews: PersonCrews;
  door: Pick<PersonShipDoor, 'inbox'>;
  changes: InboxChanges;
  wakePerson: WakePerson;
  clock: Clock;
  sleep: Sleep;
  /** How long to wait after each refusal in a row; the last repeats. */
  againWaitsMs: readonly number[];
  /** How long to wait before a wake that failed is tried again, each in a row; the last repeats. */
  wakeAgainWaitsMs: readonly number[];
}): WaitOnPersonShip {
  return async (ship, signal) => {
    const { fleetId, shipId } = ship;
    let knownWaiting: number | undefined;
    let refusedInARow = 0;
    /** When to ask for a wake again though the count did not rise: a window ended, or a failed wake waited out. */
    let wakeAgainAt: Date | undefined;
    let failedWakesInARow = 0;
    // Read as a call, as the signal aborts between awaits.
    const isStopped = (): boolean => signal.aborted;
    /** Drops the crew that no longer works, unless the ship was crewed again meanwhile: whether it was dropped. */
    const isDropped = async (crewToken: string): Promise<boolean> => {
      const held = await deps.crews.find(fleetId, shipId);
      if (held?.crewToken !== crewToken) {
        return false;
      }
      await deps.crews.drop(fleetId, shipId);
      return true;
    };
    const waitOf = (waitsMs: readonly number[], inARow: number): number => waitsMs[Math.min(inARow, waitsMs.length - 1)] ?? 0;
    while (!isStopped()) {
      const crew = await deps.crews.find(fleetId, shipId);
      if (crew === undefined) {
        return { reason: 'noCrew' };
      }
      // A wake held back is asked for again once due, so the wait ends by then.
      const atMostMs = wakeAgainAt === undefined ? undefined : Math.max(0, wakeAgainAt.getTime() - deps.clock.now().getTime());
      const answered = await deps.door.inbox(crew.crewToken, knownWaiting === undefined ? undefined : { knownWaiting, signal, ...(atMostMs === undefined ? {} : { atMostMs }) });
      if (isStopped()) {
        break;
      }
      if (!answered.isOk) {
        if (isEndedCrew(answered.error)) {
          if (await isDropped(crew.crewToken)) {
            return { reason: 'crewEnded' };
          }
          continue;
        }
        await deps.sleep(waitOf(deps.againWaitsMs, refusedInARow), signal);
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
      const isWakeDue = wakeAgainAt !== undefined && wakeAgainAt.getTime() <= deps.clock.now().getTime();
      if (!hasRisen && !isWakeDue) {
        continue;
      }
      const woken = await deps.wakePerson(ship, crew.crewToken);
      if (!woken.isOk && isEndedCrew(woken.error) && (await isDropped(crew.crewToken))) {
        return { reason: 'crewEnded' };
      }
      // A wake the fleet refused counts as one that failed: tried again after a wait.
      const outcome = woken.isOk ? woken.value : ({ kind: 'failed' } as const);
      switch (outcome.kind) {
        case 'settled':
          wakeAgainAt = undefined;
          failedWakesInARow = 0;
          break;
        case 'inWindow':
          wakeAgainAt = outcome.until;
          failedWakesInARow = 0;
          break;
        case 'failed':
          wakeAgainAt = new Date(deps.clock.now().getTime() + waitOf(deps.wakeAgainWaitsMs, failedWakesInARow));
          failedWakesInARow += 1;
          break;
      }
    }
    return { reason: 'stopped' };
  };
}
