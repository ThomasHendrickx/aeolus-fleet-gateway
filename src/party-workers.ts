/**
 * The gateway's workers, one per crewed party, each until the gateway stops
 * or the fleet refuses its crew token: an outside server's states its proxy
 * ship, then takes its calls (interop 5.2); an outside client's takes the
 * replies to its calls (Q9 a).
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
  /** Stops every worker, once its calls in flight ended. */
  stop(): Promise<void>;
}

export function createPartyWorkers(deps: { parties: PartyStore; stateParty: StateParty; runParty: RunParty; collectReplies: CollectReplies; log: FastifyBaseLogger }): PartyWorkers {
  const stop = new AbortController();
  const running = new Map<string, Promise<void>>();

  const work = async ({ fleetId, name }: { fleetId: FleetId; name: string }): Promise<void> => {
    const party = await deps.parties.find(fleetId, name);
    // A person's ship takes no worker: its deliveries are the person's own, read from their chat.
    if (party?.state !== 'crewed' || party.kind === 'person') {
      return;
    }
    if (party.kind === 'mcpClient') {
      const { ended } = await deps.collectReplies({ party, signal: stop.signal });
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
