#!/usr/bin/env node
/**
 * `aeolus-gateway start`: checks that the fleet's core is new enough, then
 * serves until SIGINT or SIGTERM. Every setting comes from environment
 * variables (src/config.ts).
 */
import Fastify from 'fastify';

import { requireCoreVersion } from '../adapters/fleet/core-version.js';
import { runningVersion } from '../adapters/http/version.js';
import { ConfigError, loadConfig } from '../config.js';

const USAGE = 'Usage: aeolus-gateway start';

async function start(): Promise<void> {
  const config = loadConfig(process.env);
  await requireCoreVersion(config.fleetUrl);
  const server = Fastify({ logger: { level: config.logLevel } });
  server.get('/api/version', () => ({ gateway: runningVersion() }));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void server.close().then(() => process.exit(0));
    });
  }
  await server.listen({ host: config.host, port: config.port });
}

try {
  switch (process.argv[2] ?? '') {
    case 'start':
      await start();
      break;
    default:
      process.stderr.write(`${USAGE}\n`);
      process.exitCode = 2;
  }
} catch (error) {
  if (error instanceof ConfigError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
