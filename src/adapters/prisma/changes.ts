/**
 * The changes the pages' live channel hears from Postgres. A trigger
 * announces each committed change to a fleet's pending requests on the
 * `gateway_changes` channel, naming only the fleet and the topic, so every
 * gateway instance hears a decision made on any of them. One connection per
 * instance listens; when it is lost, it connects again and asks its listener
 * to read everything anew, as changes made meanwhile were not heard.
 */
import { idSchema, type FleetId } from '@aeolus-fleet/common';
import pg from 'pg';
import { z } from 'zod';

/** A change a page may show: which fleet, and what changed in it. */
export interface Change {
  readonly fleetId: FleetId;
  readonly topic: 'requests';
}

const CHANNEL = 'gateway_changes';

/** How the listening connection names itself, so Postgres and its operators can tell it apart. */
const APPLICATION_NAME = 'aeolus-gateway-changes';

const RECONNECT_FIRST_MS = 100;
const RECONNECT_MOST_MS = 5000;

const changeSchema = z.object({ fleetId: idSchema('fleet'), topic: z.literal('requests') });

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

  await connect();
  return {
    close: async () => {
      isClosed = true;
      clearTimeout(retry);
      await client?.end();
    },
  };
}
