/**
 * The gateway's own ship taking what waits for it, one round at a time: each
 * receive waits while the fleet waits for a delivery, so argo's ping is
 * answered as it comes (blueprint, "Ping"); stopping ends the wait.
 */
import type { FastifyBaseLogger } from 'fastify';

import type { AnswerPings } from './core/connection/answer-pings.js';
import type { Sleep } from './core/mcp-out/run-party.js';

export interface PingWorker {
  /** Runs a round every interval until it stops. */
  start(): void;
  /** Stops, once the round under way ended. */
  stop(): Promise<void>;
}

export function createPingWorker(deps: { answerPings: AnswerPings; sleep: Sleep; intervalMs: number; log: FastifyBaseLogger }): PingWorker {
  const stopping = new AbortController();
  let running: Promise<void> = Promise.resolve();

  const round = async (): Promise<void> => {
    try {
      const { acked, refused } = await deps.answerPings(stopping.signal);
      for (const { contentType, senderShipId } of acked) {
        deps.log.info({ contentType, senderShipId }, "the gateway's ship acked a message it does not handle");
      }
      if (refused > 0) {
        deps.log.debug({ refused }, "the fleet refused some calls of the gateway's ship's inbox");
      }
    } catch (error) {
      deps.log.error({ err: error }, 'ping round failed');
    }
  };

  return {
    start: () => {
      running = (async () => {
        while (!stopping.signal.aborted) {
          await round();
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
