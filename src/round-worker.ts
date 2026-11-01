/**
 * A worker of rounds, one at a time, until it stops: a round at its start, so
 * a restart goes on with what was stored, one every interval, and one at once
 * when woken. The basket's sender (docs/design/bridge, section 9) is woken
 * when a person presses Send; the Slack posts' editor (section 7, view sync)
 * when a person's inbox changed.
 */
import type { FastifyBaseLogger } from 'fastify';

import type { Sleep } from './core/mcp-out/run-party.js';

export interface RoundWorker {
  start(): void;
  /** Runs the next round now, not at the next interval. */
  wake(): void;
  /** Stops, once the round under way ended. */
  stop(): Promise<void>;
}

export function createRoundWorker(deps: { name: string; round: () => Promise<unknown>; sleep: Sleep; intervalMs: number; log: FastifyBaseLogger }): RoundWorker {
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
            await deps.round();
          } catch (error) {
            deps.log.error({ err: error }, `${deps.name} round failed`);
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
