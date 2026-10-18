/**
 * The gateway's process: its HTTP server and its database. What it serves
 * grows slice by slice; today it answers whoever operates the installation.
 */
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { runningVersion } from './adapters/http/version.js';
import { checkDatabase, createPrismaClient } from './adapters/prisma/client.js';

/** The status Fastify answers while the database does not. */
const HTTP_SERVICE_UNAVAILABLE = 503;

export interface GatewayAppOptions {
  databaseUrl: string;
  logger?: FastifyServerOptions['logger'];
}

export interface GatewayApp {
  /** The HTTP server: `/api/health` and `/api/version` for whoever operates the installation. */
  server: FastifyInstance;
  close(): Promise<void>;
}

export function createGatewayApp(options: GatewayAppOptions): GatewayApp {
  const prisma = createPrismaClient(options.databaseUrl);
  const server = Fastify({ logger: options.logger ?? true });

  // Only the version this process runs: no authentication, so nothing about its database or fleets.
  const version = runningVersion();
  server.get('/api/version', () => ({ gateway: version }));

  // Up and its database reachable; nothing about its fleets.
  server.get('/api/health', async (_request, reply) => {
    try {
      await checkDatabase(prisma);
      return { status: 'ok' };
    } catch (error) {
      server.log.error({ err: error }, 'database unreachable');
      return reply.code(HTTP_SERVICE_UNAVAILABLE).send({ status: 'unavailable' });
    }
  });

  return {
    server,
    close: async () => {
      await server.close();
      await prisma.$disconnect();
    },
  };
}
