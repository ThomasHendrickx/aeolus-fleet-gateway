/** Reconciles the gateway's own held leases. Each lease looks independently and serially. */
import type { FleetId } from '@aeolus-fleet/common';

import type { IsServed } from '../installation/served.js';
import type { ConnectionStore, GatewayCrew } from './ports.js';
import type { ShipWakeups } from './ship-wakeups.js';

interface WatchGatewayShipsDeps {
  connections: ConnectionStore;
  wakeups: ShipWakeups;
  isServed: IsServed;
  look: (crew: GatewayCrew, signal: AbortSignal) => Promise<void>;
  failed: (error: unknown) => void;
}

export function createWatchGatewayShips(deps: WatchGatewayShipsDeps): { reconcile: () => Promise<void>; stop: () => Promise<void> } {
  const running = new Map<FleetId, { token: string; stop: AbortController; done: Promise<void> }>();
  let isStopped = false;
  const isActive = () => !isStopped;
  const start = (crew: GatewayCrew) => {
    const stop = new AbortController();
    const looks = deps.wakeups(crew.crewToken, stop.signal);
    const entry = { token: crew.crewToken, stop, done: Promise.resolve() };
    running.set(crew.fleetId, entry);
    entry.done = (async () => {
      try {
        while (await looks.wait()) {
          if (stop.signal.aborted) { break; }
          await deps.look(crew, stop.signal);
          const held = await deps.connections.find(crew.fleetId);
          if (held?.crewToken !== crew.crewToken) { break; }
        }
        if (looks.isEnded()) {
          const held = await deps.connections.find(crew.fleetId);
          if (held?.crewToken === crew.crewToken) { await deps.connections.drop(crew.fleetId); }
        }
      } finally {
        stop.abort();
        looks.close();
        if (running.get(crew.fleetId) === entry) { running.delete(crew.fleetId); }
      }
    })().catch(deps.failed);
  };
  return {
    reconcile: async () => {
      if (!isActive()) { return; }
      const served: GatewayCrew[] = [];
      for (const crew of await deps.connections.connected()) {
        if (await deps.isServed(crew.fleetId)) { served.push(crew); }
      }
      if (!isActive()) { return; }
      for (const [fleetId, entry] of running) {
        if (!served.some((crew) => crew.fleetId === fleetId && crew.crewToken === entry.token)) {
          entry.stop.abort();
          running.delete(fleetId);
        }
      }
      for (const crew of served) {
        if (!running.has(crew.fleetId)) { start(crew); }
      }
    },
    stop: async () => {
      isStopped = true;
      const held = [...running.values()];
      for (const entry of held) { entry.stop.abort(); }
      await Promise.all(held.map(({ done }) => done));
    },
  };
}
