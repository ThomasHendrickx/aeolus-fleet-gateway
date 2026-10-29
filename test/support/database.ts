import { migrateDatabase } from '../../src/adapters/prisma/migrate.js';
import { aNewDatabaseUrl } from './fleet-server.js';

/** A new gateway database in the shared Postgres, migrated as `aeolus-gateway migrate` migrates it. */
export async function migratedDatabase(adminUrl: string): Promise<string> {
  const databaseUrl = aNewDatabaseUrl(adminUrl, 'gateway');
  await migrateDatabase(databaseUrl);
  return databaseUrl;
}
