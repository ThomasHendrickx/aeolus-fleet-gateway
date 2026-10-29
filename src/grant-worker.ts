/**
 * The gateway's rounds over grants (decision 0067): every interval, until
 * it stops, a round refreshes the grants that are idle or near their end
 * (Q7) and ends the grants of retired person ships (Q6). Every gateway
 * instance runs one; the grant's row lock keeps their refreshes of one
 * grant one at a time.
 */
import type { FastifyBaseLogger } from 'fastify';

import type { Sleep } from './core/mcp-out/run-party.js';

export interface GrantWorker {
  start(): void;
  /** Stops, once the round under way ended. */
  stop(): Promise<void>;
}

export function createGrantWorker(deps: { round: () => Promise<void>; sleep: Sleep; intervalMs: number; log: FastifyBaseLogger }): GrantWorker {
  const stopping = new AbortController();
  let running: Promise<void> = Promise.resolve();
  return {
    start: () => {
      running = (async () => {
        while (!stopping.signal.aborted) {
          try {
            await deps.round();
          } catch (error) {
            deps.log.error({ err: error }, 'grant round failed');
          }
          await deps.sleep(deps.intervalMs, stopping.signal);
        }
      })();
    },
    stop: async () => {
      stopping.abort();
      await running;
    },
  };
}
