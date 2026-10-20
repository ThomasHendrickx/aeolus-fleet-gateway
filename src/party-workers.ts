/**
 * The gateway's workers, one per crewed party, each until the gateway stops
 * or the fleet refuses its crew token: an outside server's states its proxy
 * ship, then takes its calls (interop 5.2); an outside client's takes the
 * replies to its calls (Q9 a). A fleet's workers work only while its outside
 * parties are on (interop I-3).
 */
import type { FleetId } from '@aeolus-fleet/common';
import type { FastifyBaseLogger } from 'fastify';

import type { CollectReplies } from './core/mcp-in/collect-replies.js';
import type { RunParty } from './core/mcp-out/run-party.js';
import type { StateParty } from './core/mcp-out/state-party.js';
import type { PartyStore } from './core/parties/ports.js';

export interface PartyWorkers {
  /** Starts the party's worker, unless it is not crewed or its worker runs already. */
  start(party: { fleetId: FleetId; name: string }): Promise<void>;
  /** Stops the fleet's workers, once their calls in flight ended, as when its outside parties go off. */
  stopFleet(fleetId: FleetId): Promise<void>;
  /** Stops every worker, once its calls in flight ended. */
  stop(): Promise<void>;
}

export function createPartyWorkers(deps: {
  parties: PartyStore;
  stateParty: StateParty;
  runParty: RunParty;
  collectReplies: CollectReplies;
  servesOutsideParties: (fleetId: FleetId) => Promise<boolean>;
  log: FastifyBaseLogger;
}): PartyWorkers {
  const stop = new AbortController();
  /** Each running worker, by fleet and party, with what stops it. */
  const running = new Map<string, { fleetId: FleetId; done: Promise<void>; stopFleet: AbortController }>();

  const work = async ({ fleetId, name }: { fleetId: FleetId; name: string }, signal: AbortSignal): Promise<void> => {
    if (!(await deps.servesOutsideParties(fleetId))) {
      return;
    }
    const party = await deps.parties.find(fleetId, name);
    if (party?.state !== 'crewed' || signal.aborted) {
      return;
    }
    if (party.kind === 'mcpClient') {
      const { ended } = await deps.collectReplies({ party, signal });
      if (ended === 'crewRefused') {
        deps.log.warn({ fleetId, party: name }, "the fleet refused the proxy ship's crew token: its calls get no replies");
      }
      return;
    }
    const stated = await deps.stateParty({ fleetId, name });
    if (!stated.isOk) {
      // Its calls are taken all the same; the next statement states it.
      deps.log.warn({ fleetId, party: name, reason: stated.error.message }, 'proxy ship not stated');
    }
    const { ended } = await deps.runParty({ party, signal });
    if (ended === 'crewRefused') {
      deps.log.warn({ fleetId, party: name }, 'the fleet refused the proxy ship\'s crew token: its calls are not taken');
    }
  };

  return {
    start: (party) => {
      const key = JSON.stringify([party.fleetId, party.name]);
      if (!running.has(key) && !stop.signal.aborted) {
        const stopFleet = new AbortController();
        const done = work(party, AbortSignal.any([stop.signal, stopFleet.signal]))
          .catch((error: unknown) => {
            deps.log.error({ err: error, fleetId: party.fleetId, party: party.name }, 'party worker failed');
          })
          .finally(() => running.delete(key));
        running.set(key, { fleetId: party.fleetId, done, stopFleet });
      }
      return Promise.resolve();
    },
    stopFleet: async (fleetId) => {
      const fleetWorkers = [...running.values()].filter((worker) => worker.fleetId === fleetId);
      for (const worker of fleetWorkers) {
        worker.stopFleet.abort();
      }
      await Promise.all(fleetWorkers.map((worker) => worker.done));
    },
    stop: async () => {
      stop.abort();
      await Promise.all([...running.values()].map((worker) => worker.done));
    },
  };
}
