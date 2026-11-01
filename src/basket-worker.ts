/**
 * The gateway's sender of the basket (docs/design/bridge, section 9): a round
 * at its start, so a restart goes on with what was stored as sending, a round
 * every interval while the fleet does not answer, and one at once when a
 * person presses Send, one round at a time, until it stops.
 */
import type { FastifyBaseLogger } from 'fastify';

import type { Sleep } from './core/mcp-out/run-party.js';
import type { SendStoredAnswers } from './core/people/send-stored-answers.js';

export interface BasketWorker {
  start(): void;
  /** Runs the next round now, not at the next interval. */
  wake(): void;
  /** Stops, once the round under way ended. */
  stop(): Promise<void>;
}

export function createBasketWorker(deps: { send: SendStoredAnswers; sleep: Sleep; intervalMs: number; log: FastifyBaseLogger }): BasketWorker {
  const stopping = new AbortController();
  let waking = new AbortController();
  /** Whether a wake came during a round: the next round runs at once. */
  let isWoken = false;
  let running: Promise<void> = Promise.resolve();
  // Read after a round: a wake or a stop may have come while it ran.
  const isToGoOn = (): boolean => isWoken || stopping.signal.aborted;
  return {
    start: () => {
      running = (async () => {
        while (!stopping.signal.aborted) {
          isWoken = false;
          try {
            await deps.send();
          } catch (error) {
            deps.log.error({ err: error }, 'basket round failed');
          }
          if (isToGoOn()) {
            continue;
          }
          waking = new AbortController();
          await deps.sleep(deps.intervalMs, AbortSignal.any([stopping.signal, waking.signal]));
        }
      })();
    },
    wake: () => {
      isWoken = true;
      waking.abort();
    },
    stop: async () => {
      stopping.abort();
      await running;
    },
  };
}
