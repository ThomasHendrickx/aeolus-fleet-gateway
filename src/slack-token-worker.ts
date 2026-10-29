/**
 * The gateway keeping each fleet's Slack configuration token alive (gateway
 * scopes 9.1): a rotation pass every interval, well within the hour before
 * a token ends, until it stops.
 */
import type { FastifyBaseLogger } from 'fastify';

import type { Sleep } from './core/mcp-out/run-party.js';
import type { RotateConfigurationTokens } from './core/slack/rotate-configuration-tokens.js';

export interface SlackTokenWorker {
  start(): void;
  /** Stops, once the pass under way ended. */
  stop(): Promise<void>;
}

export function createSlackTokenWorker(deps: { rotate: RotateConfigurationTokens; sleep: Sleep; intervalMs: number; log: FastifyBaseLogger }): SlackTokenWorker {
  const stopping = new AbortController();
  let running: Promise<void> = Promise.resolve();
  return {
    start: () => {
      running = (async () => {
        while (!stopping.signal.aborted) {
          try {
            await deps.rotate();
          } catch (error) {
            deps.log.error({ err: error }, 'Slack configuration token pass failed');
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
