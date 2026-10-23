/**
 * The locks of the person ships' waiters, as Postgres advisory locks in the
 * gateway's database (wake a person, W9): one connection per instance holds
 * every lock the instance took, so when it ends, Postgres frees them all and
 * another instance can take them. The next take connects again. A lock is
 * keyed by the hashes of the fleet and the ship: two ships sharing both
 * share one lock, so their waiters run on the same instance.
 */
import pg from 'pg';

import type { WaiterLocks } from '../../core/people/ports.js';

/** How the locking connection names itself, so Postgres and its operators can tell it apart. */
const APPLICATION_NAME = 'aeolus-gateway-waiters';

export function createPostgresWaiterLocks(databaseUrl: string): WaiterLocks & { close(): Promise<void> } {
  const listeners: (() => void)[] = [];
  let connected: Promise<pg.Client> | undefined;
  let isClosed = false;

  const lost = (client: Promise<pg.Client>): void => {
    if (connected === client) {
      connected = undefined;
      for (const listener of listeners) {
        listener();
      }
    }
  };

  const connection = (): Promise<pg.Client> => {
    if (connected !== undefined) {
      return connected;
    }
    const client = new pg.Client({ connectionString: databaseUrl, application_name: APPLICATION_NAME });
    const connecting = client.connect().then(
      () => client,
      async (error: unknown) => {
        connected = undefined;
        await client.end().catch(() => undefined);
        throw error;
      },
    );
    // A lost connection loses every lock; its 'end' follows any 'error'.
    client.on('error', () => undefined);
    client.on('end', () => {
      lost(connecting);
    });
    connected = connecting;
    return connecting;
  };

  return {
    take: async ({ fleetId, shipId }) => {
      if (isClosed) {
        return false;
      }
      try {
        const client = await connection();
        const taken = await client.query<{ isTaken: boolean }>('SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS "isTaken"', [fleetId, shipId]);
        return taken.rows[0]?.isTaken === true;
      } catch {
        // The database does not answer: no lock is taken now; the next round tries again.
        return false;
      }
    },
    give: async ({ fleetId, shipId }) => {
      const client = await connected?.catch(() => undefined);
      await client?.query('SELECT pg_advisory_unlock(hashtext($1), hashtext($2))', [fleetId, shipId]).catch(() => undefined);
    },
    onLost: (listener) => {
      listeners.push(listener);
    },
    close: async () => {
      isClosed = true;
      const client = await connected?.catch(() => undefined);
      connected = undefined;
      await client?.end();
    },
  };
}
