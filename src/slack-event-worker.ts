/**
 * The gateway's sends from Slack into the fleet (gateway scopes 9.4): a
 * round every interval, and one at once when a person's message is kept,
 * one round at a time, until it stops.
 */
import type { FastifyBaseLogger } from 'fastify';

import type { Sleep } from './core/mcp-out/run-party.js';
import type { SendSlackEvents } from './core/slack/send-slack-events.js';

export interface SlackEventWorker {
  start(): void;
  /** Runs the next round now, not at the next interval. */
  wake(): void;
  /** Stops, once the round under way ended. */
  stop(): Promise<void>;
}

export function createSlackEventWorker(deps: { send: SendSlackEvents; sleep: Sleep; intervalMs: number; log: FastifyBaseLogger }): SlackEventWorker {
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
            deps.log.error({ err: error }, 'Slack event round failed');
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
