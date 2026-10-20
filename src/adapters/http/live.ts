/**
 * The pages' live channel: a page whose content changes opens a websocket
 * on /live naming itself, and is sent its sections again whenever its
 * fleet's requests change, so it never reloads itself or polls. A change
 * carries no content: each socket reads its page again through the
 * gateway's API as its own caller, so it is never sent what its actor may
 * not see. Only the gateway's own pages open it: a socket from another
 * origin, with no session, or for a page that is not live is closed.
 */
import websocket from '@fastify/websocket';
import type { FleetId } from '@aeolus-fleet/common';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';

import type { Change } from '../prisma/changes.js';
import type { Context } from '../trpc/router.js';
import { isSameOrigin } from './html.js';

/** A page the live channel serves: its sections' HTML by name, read as the caller, from the page's query. */
export interface LivePage {
  render(context: Context, params: URLSearchParams): Promise<Record<string, string>>;
}

/** Why a socket was closed, as the page reads it: it does not open again for these. */
const CLOSE_NO_SESSION = 4401;
const CLOSE_OTHER_ORIGIN = 4403;
const CLOSE_NOT_LIVE = 4404;

interface Listener {
  readonly fleetId: FleetId;
  readonly read: () => void;
}

/** Hands each change to the sockets of its fleet, on this gateway. */
export interface ChangeHub {
  publish(change: Change): void;
  /** Every socket reads its page again: changes may have been missed. */
  resync(): void;
  subscribe(listener: Listener): () => void;
  listeners(): number;
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

/** Reads a page again and sends it, one read at a time per socket, so an older read never lands after a newer one. */
function reader(send: { socket: WebSocket; read: () => Promise<Record<string, string>> }): () => void {
  let isReading = false;
  let isWanted = false;
  const run = async (): Promise<void> => {
    isReading = true;
    while (isWanted) {
      isWanted = false;
      try {
        const sections = await send.read();
        if (send.socket.readyState === send.socket.OPEN) {
          send.socket.send(JSON.stringify({ sections }));
        }
      } catch {
        // A read that failed leaves the page as it was; the next change reads it again.
      }
    }
    isReading = false;
  };
  return () => {
    isWanted = true;
    if (!isReading) {
      void run();
    }
  };
}

export async function registerLive(server: FastifyInstance, deps: { contextFor: (cookie: string | undefined) => Context; hub: ChangeHub; pages: Record<string, LivePage> }): Promise<void> {
  await server.register(websocket);
  server.get('/live', { websocket: true }, async (socket, request) => {
    if (!isSameOrigin(request)) {
      socket.close(CLOSE_OTHER_ORIGIN, 'Opened only from the gateway pages');
      return;
    }
    const params = new URLSearchParams(request.url.slice(request.url.indexOf('?') + 1));
    const page = deps.pages[params.get('page') ?? ''];
    if (page === undefined) {
      socket.close(CLOSE_NOT_LIVE, 'No such live page');
      return;
    }
    const context = deps.contextFor(request.headers.cookie);
    const actor = await context.authenticateActor({ cookie: context.cookie, crewToken: context.crewToken });
    if (!actor.isOk) {
      socket.close(CLOSE_NO_SESSION, 'Sign in again');
      return;
    }
    const read = reader({ socket, read: () => page.render(context, params) });
    const unsubscribe = deps.hub.subscribe({ fleetId: actor.value.fleetId, read });
    socket.on('close', unsubscribe);
    read();
  });
}
