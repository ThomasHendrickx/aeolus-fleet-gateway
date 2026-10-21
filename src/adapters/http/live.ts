/**
 * What hears each committed change to a fleet's requests on this gateway:
 * the API's requests.changes, which the web app's pages follow, and the
 * waiting page of a client asked for. A change carries no content: each
 * listener reads what it shows again, as its own caller.
 */
import websocket from '@fastify/websocket';
import type { FleetId } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';

import type { Change } from '../prisma/changes.js';

interface Listener {
  readonly fleetId: FleetId;
  readonly read: () => void;
}

/** Hands each change to the listeners of its fleet, on this gateway. */
export interface ChangeHub {
  publish: (change: Change) => void;
  /** Every listener reads again: changes may have been missed. */
  resync: () => void;
  subscribe: (listener: Listener) => () => void;
  listeners: () => number;
}

export function createChangeHub(): ChangeHub {
  const listening = new Set<Listener>();
  return {
    publish: (change) => {
      for (const listener of listening) {
        if (listener.fleetId === change.fleetId) {
          listener.read();
        }
      }
    },
    resync: () => {
      for (const listener of listening) {
        listener.read();
      }
    },
    subscribe: (listener) => {
      listening.add(listener);
      return () => listening.delete(listener);
    },
    listeners: () => listening.size,
  };
}

const servingWebsockets = new WeakSet<FastifyInstance>();

/** Serves websockets on the server, once whichever route asks first; its routes register once it is loaded. */
export function acceptWebsockets(server: FastifyInstance, routes: () => void): void {
  if (!servingWebsockets.has(server)) {
    servingWebsockets.add(server);
    void server.register(websocket);
  }
  void server.after(routes);
}
