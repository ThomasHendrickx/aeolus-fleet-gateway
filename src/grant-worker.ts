/**
 * The gateway keeping grants alive (decision 0067, Q7): a round every
 * interval refreshes the grants that are idle or near their end, until it
 * stops. Every gateway instance runs one; the grant's row lock keeps their
 * refreshes of one grant one at a time.
 */
import type { FastifyBaseLogger } from 'fastify';

import type { Sleep } from './core/mcp-out/run-party.js';
import type { KeepGrantsAlive } from './core/party-grants/keep-grants-alive.js';

export interface GrantWorker {
  start(): void;
  /** Stops, once the round under way ended. */
  stop(): Promise<void>;
}

export function createGrantWorker(deps: { keepAlive: KeepGrantsAlive; sleep: Sleep; intervalMs: number; log: FastifyBaseLogger }): GrantWorker {
  const stopping = new AbortController();
  let running: Promise<void> = Promise.resolve();
  return {
    start: () => {
      running = (async () => {
        while (!stopping.signal.aborted) {
          try {
            await deps.keepAlive();
          } catch (error) {
            deps.log.error({ err: error }, 'grant keep-alive round failed');
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
