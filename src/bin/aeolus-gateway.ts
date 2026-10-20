#!/usr/bin/env node
/**
 * `aeolus-gateway start`: checks that the fleet's core is new enough,
 * migrates the gateway's database, connects again to every fleet with its
 * kept crew token, then serves until SIGINT or SIGTERM.
 * `aeolus-gateway migrate`: migrates the database alone. Every setting
 * comes from environment variables (src/config.ts).
 */
import { requireCoreVersion } from '../adapters/fleet/core-version.js';
import { MigrationError, migrateDatabase } from '../adapters/prisma/migrate.js';
import { createGatewayApp } from '../app.js';
import { ConfigError, loadConfig, loadDatabaseUrl } from '../config.js';

const USAGE = 'Usage: aeolus-gateway start | migrate';

async function start(): Promise<void> {
  const config = loadConfig(process.env);
  await requireCoreVersion(config.fleetUrl);
  await migrateDatabase(config.databaseUrl);
  const app = createGatewayApp({
    databaseUrl: config.databaseUrl,
    fleetUrl: config.fleetUrl,
    publicUrl: config.publicUrl,
    gatewaySecret: config.gatewaySecret,
    mcpWaitMaxMs: config.mcpWaitMaxMs,
    logger: { level: config.logLevel },
    ...(config.installationToken === undefined ? {} : { installationToken: config.installationToken }),
    ...(config.pagasae === undefined ? {} : { pagasae: config.pagasae }),
  });
  // Every fleet the gateway was connected to, connected again with its kept crew token.
  const restored = await app.restoreConnections();
  for (const { fleetId, ship } of restored) {
    app.server.log.info({ fleet: fleetId, ship }, 'connected as the gateway ship');
  }
  if (restored.length === 0) {
    app.server.log.warn('connected to no fleet: argo connects the gateway in the console');
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  }
  await app.server.listen({ host: config.host, port: config.port });
}

try {
  switch (process.argv[2] ?? '') {
    case 'start':
      await start();
      break;
    case 'migrate':
      await migrateDatabase(loadDatabaseUrl(process.env));
      break;
    default:
      process.stderr.write(`${USAGE}\n`);
      process.exitCode = 2;
  }
} catch (error) {
  if (error instanceof ConfigError || error instanceof MigrationError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
