/**
 * The gateway's workers, one per crewed party: each states its proxy ship,
 * then takes its calls until the gateway stops or the fleet refuses its
 * crew token (interop 5.2).
 */
import type { FleetId } from '@aeolus-fleet/common';
import type { FastifyBaseLogger } from 'fastify';

import type { RunParty } from './core/mcp-out/run-party.js';
import type { StateParty } from './core/mcp-out/state-party.js';
import type { PartyStore } from './core/parties/ports.js';

export interface PartyWorkers {
  /** Starts taking the party's calls, unless it is not crewed or its worker runs already. */
  start(party: { fleetId: FleetId; name: string }): Promise<void>;
  /** Stops every worker, once its calls in flight ended. */
  stop(): Promise<void>;
}

export function createPartyWorkers(deps: { parties: PartyStore; stateParty: StateParty; runParty: RunParty; log: FastifyBaseLogger }): PartyWorkers {
  const stop = new AbortController();
  const running = new Map<string, Promise<void>>();

  const work = async ({ fleetId, name }: { fleetId: FleetId; name: string }): Promise<void> => {
    const party = await deps.parties.find(fleetId, name);
    if (party?.state !== 'crewed') {
      return;
    }
    const stated = await deps.stateParty({ fleetId, name });
    if (!stated.isOk) {
      // Its calls are taken all the same; the next statement states it.
      deps.log.warn({ fleetId, party: name, reason: stated.error.message }, 'proxy ship not stated');
    }
    const { ended } = await deps.runParty({ party, signal: stop.signal });
    if (ended === 'crewRefused') {
      deps.log.warn({ fleetId, party: name }, 'the fleet refused the proxy ship\'s crew token: its calls are not taken');
    }
  };

  return {
    start: (party) => {
      const key = JSON.stringify([party.fleetId, party.name]);
      if (!running.has(key) && !stop.signal.aborted) {
        running.set(
          key,
          work(party)
            .catch((error: unknown) => {
              deps.log.error({ err: error, fleetId: party.fleetId, party: party.name }, 'party worker failed');
            })
            .finally(() => running.delete(key)),
        );
      }
      return Promise.resolve();
    },
    stop: async () => {
      stop.abort();
      await Promise.all(running.values());
    },
  };
}
