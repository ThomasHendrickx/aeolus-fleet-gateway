/**
 * The gateway's waiters, one per person ship it crews, across its instances
 * (wake a person, W7, W9): an instance runs a ship's waiter only while it
 * holds the ship's lock. Each round it looks for crews whose waiter no
 * instance runs, so the waiters of an instance that stopped, or lost its
 * locks, are taken over; a ship crewed meanwhile is woken at once. A waiter
 * that ends gives its lock back.
 */
import type { FastifyBaseLogger } from 'fastify';

import type { Sleep } from './core/mcp-out/run-party.js';
import type { PersonCrews, PersonShip, WaiterLocks } from './core/people/ports.js';
import type { WaitOnPersonShip } from './core/people/wait-on-person-ship.js';

/** How many crews a round reads at once. */
const ROUND_PAGE = 100;

export interface PersonWaiters {
  /** Runs a round every interval until it stops. */
  start(): void;
  /** Starts the ship's waiter now, unless one runs: the gateway just crewed it. */
  wake(ship: PersonShip): void;
  /** The ships this instance waits on now. */
  waitingOn(): PersonShip[];
  /** Stops every waiter and gives its lock back. */
  stop(): Promise<void>;
}

export function createPersonWaiters(deps: { crews: PersonCrews; locks: WaiterLocks; waitOnPersonShip: WaitOnPersonShip; sleep: Sleep; roundMs: number; log: FastifyBaseLogger }): PersonWaiters {
  const stopping = new AbortController();
  /** Each ship this instance waits on, or takes the lock of, with what stops its waiter. */
  const running = new Map<string, { ship: PersonShip; isWaiting: boolean; stop: AbortController; done: Promise<void> }>();
  let rounds: Promise<void> = Promise.resolve();

  const keyOf = ({ fleetId, shipId }: PersonShip): string => `${fleetId}/${shipId}`;

  const run = async (ship: PersonShip, stop: AbortController): Promise<void> => {
    if (!(await deps.locks.take(ship))) {
      return;
    }
    const held = running.get(keyOf(ship));
    if (held === undefined || stop.signal.aborted) {
      await deps.locks.give(ship);
      return;
    }
    held.isWaiting = true;
    try {
      const ended = await deps.waitOnPersonShip(ship, stop.signal);
      if (ended.reason === 'crewEnded') {
        deps.log.info(ship, "the person ship's crew no longer works: its waiter stopped and the crew was dropped");
      }
    } finally {
      await deps.locks.give(ship);
    }
  };

  const wake = (ship: PersonShip): void => {
    const key = keyOf(ship);
    if (running.has(key) || stopping.signal.aborted) {
      return;
    }
    const stop = new AbortController();
    const entry = { ship, isWaiting: false, stop, done: Promise.resolve() };
    running.set(key, entry);
    entry.done = run(ship, stop)
      .catch((error: unknown) => {
        deps.log.error({ err: error, ...ship }, 'person ship waiter failed');
      })
      .finally(() => running.delete(key));
  };

  const round = async (): Promise<void> => {
    try {
      let after: PersonShip | null = null;
      for (;;) {
        const page = await deps.crews.crewed({ after, limit: ROUND_PAGE });
        for (const ship of page) {
          wake(ship);
        }
        const last = page.at(-1);
        if (page.length < ROUND_PAGE || last === undefined) {
          return;
        }
        after = last;
      }
    } catch (error) {
      deps.log.error({ err: error }, 'person ship waiters round failed');
    }
  };

  // Every lock is lost at once: their waiters stop, and the next round takes the locks again where no instance holds them.
  deps.locks.onLost(() => {
    for (const entry of running.values()) {
      entry.stop.abort();
    }
  });

  return {
    start: () => {
      rounds = (async () => {
        while (!stopping.signal.aborted) {
          await round();
          await deps.sleep(deps.roundMs, stopping.signal);
        }
      })();
    },
    wake,
    waitingOn: () => [...running.values()].filter(({ isWaiting }) => isWaiting).map(({ ship }) => ship),
    stop: async () => {
      stopping.abort();
      for (const entry of running.values()) {
        entry.stop.abort();
      }
      await rounds;
      await Promise.all([...running.values()].map(({ done }) => done));
    },
  };
}
