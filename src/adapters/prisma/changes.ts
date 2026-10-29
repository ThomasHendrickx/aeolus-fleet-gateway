/**
 * The changes the pages' live channel hears from Postgres, on the
 * `gateway_changes` channel, so every gateway instance hears a change made
 * on any of them: a trigger announces each committed change to a fleet's
 * pending requests, naming only the fleet and the topic; the gateway tells
 * each change to a person ship's inbox, naming the fleet and the ship. One connection per
 * instance listens; when it is lost, or the database does not answer at
 * start, it connects again and asks its listener to read everything anew,
 * as changes made meanwhile were not heard.
 */
import { idSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import pg from 'pg';
import { z } from 'zod';

import type { InboxChanges } from '../../core/people/ports.js';
import type { Db } from './client.js';

/** A change a page may show: which fleet, and what changed in it: its requests, or a person ship's inbox. */
export type Change = { readonly fleetId: FleetId; readonly topic: 'requests' } | { readonly fleetId: FleetId; readonly topic: 'inbox'; readonly shipId: ShipId };

const CHANNEL = 'gateway_changes';

/** How the listening connection names itself, so Postgres and its operators can tell it apart. */
const APPLICATION_NAME = 'aeolus-gateway-changes';

const RECONNECT_FIRST_MS = 100;
const RECONNECT_MOST_MS = 5000;

const changeSchema = z.discriminatedUnion('topic', [
  z.object({ fleetId: idSchema('fleet'), topic: z.literal('requests') }),
  z.object({ fleetId: idSchema('fleet'), topic: z.literal('inbox'), shipId: idSchema('ship') }),
]);

/** Tells every gateway instance that a person ship's inbox changed. */
export function createPrismaInboxChanges(db: Db): InboxChanges {
  return {
    tell: async ({ fleetId, shipId }) => {
      const change: Change = { fleetId, topic: 'inbox', shipId };
      await db.$executeRaw`SELECT pg_notify(${CHANNEL}, ${JSON.stringify(change)})`;
    },
  };
}

function parsedJson(text: string | undefined): unknown {
  try {
    return JSON.parse(text ?? 'null');
  } catch {
    return undefined;
  }
}

export async function listenToChanges(databaseUrl: string, listener: { onChange: (change: Change) => void; onResync: () => void }): Promise<{ close(): Promise<void> }> {
  let client: pg.Client | undefined;
  let isClosed = false;
  let wait = RECONNECT_FIRST_MS;
  let retry: NodeJS.Timeout | undefined;

  const connect = async (): Promise<void> => {
    const connecting = new pg.Client({ connectionString: databaseUrl, application_name: APPLICATION_NAME });
    connecting.on('notification', (notification) => {
      const change = changeSchema.safeParse(parsedJson(notification.payload));
      if (change.success) {
        listener.onChange(change.data);
      }
    });
    // A lost connection is connected again; its 'end' follows any 'error'.
    connecting.on('error', () => undefined);
    connecting.on('end', () => {
      if (!isClosed && client === connecting) {
        client = undefined;
        reconnect();
      }
    });
    try {
      await connecting.connect();
      await connecting.query(`LISTEN ${CHANNEL}`);
    } catch (error) {
      await connecting.end().catch(() => undefined);
      throw error;
    }
    if (isClosed) {
      // Closed while it was connecting: it is not kept.
      await connecting.end();
      return;
    }
    client = connecting;
    wait = RECONNECT_FIRST_MS;
  };

  const reconnect = (): void => {
    retry = setTimeout(() => {
      connect().then(
        () => {
          listener.onResync();
        },
        () => {
          wait = Math.min(wait * 2, RECONNECT_MOST_MS);
          if (!isClosed) {
            reconnect();
          }
        },
      );
    }, wait);
  };

  // A database that does not answer yet keeps the gateway starting: the listener connects once it does.
  await connect().catch(reconnect);
  return {
    close: async () => {
      isClosed = true;
      clearTimeout(retry);
      await client?.end();
    },
  };
}
