/**
 * The gateway's round of request outcomes (decision 0056): each round
 * expires the requests due, then tells the outcomes still to tell. Rounds
 * run one at a time, every interval, and at once when a request is decided;
 * a round asked for while one runs runs right after it.
 */
import type { FastifyBaseLogger } from 'fastify';

import type { Sleep } from './core/mcp-out/run-party.js';
import type { ExpireRequests } from './core/requests/expire-requests.js';
import type { TellOutcomes } from './core/requests/tell-outcomes.js';

export interface OutcomeWorker {
  /** Runs a round every interval until it stops. */
  start(): void;
  /** Runs a round now, as when a request was decided. */
  tellNow(): void;
  /** Stops, once the round under way ended. */
  stop(): Promise<void>;
}

export function createOutcomeWorker(deps: { expireRequests: ExpireRequests; tellOutcomes: TellOutcomes; sleep: Sleep; intervalMs: number; log: FastifyBaseLogger }): OutcomeWorker {
  const stopping = new AbortController();
  let running: Promise<void> = Promise.resolve();
  /** Whether a round runs, and how many were asked for since it started. */
  const rounds = { isRunning: false, asked: 0 };

  const round = async (): Promise<void> => {
    try {
      const expired = await deps.expireRequests();
      const { told, kept, refused } = await deps.tellOutcomes();
      if (refused > 0) {
        deps.log.warn({ refused }, "the fleet refused some request outcomes: their people see them on the gateway's page");
      }
      if (expired + told + kept > 0) {
        deps.log.info({ expired, told, kept }, 'request outcomes');
      }
    } catch (error) {
      deps.log.error({ err: error }, 'request outcomes round failed');
    }
  };

  const runRound = (): void => {
    rounds.asked += 1;
    if (rounds.isRunning) {
      return;
    }
    rounds.isRunning = true;
    running = (async () => {
      while (rounds.asked > 0 && !stopping.signal.aborted) {
        rounds.asked = 0;
        await round();
      }
      rounds.isRunning = false;
    })();
  };

  return {
    start: () => {
      void (async () => {
        while (!stopping.signal.aborted) {
          runRound();
          await running;
          await deps.sleep(deps.intervalMs, stopping.signal);
        }
      })();
    },
    tellNow: () => {
      if (!stopping.signal.aborted) {
        runRound();
      }
    },
    stop: async () => {
      stopping.abort();
      await running;
    },
  };
}
