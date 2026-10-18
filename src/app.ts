/**
 * The gateway wired to its own database and to the fleet's public API. Its
 * API is the console's server's and its page's, with the console's session
 * cookie, and the hosting service's, with the installation token.
 */
import type { FleetId } from '@aeolus-fleet/common';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { sha256RequestHasher } from './adapters/crypto/request-hasher.js';
import { createFleetConsoleSessions } from './adapters/fleet/console-sessions.js';
import { createRestFleetDoor } from './adapters/fleet/rest-fleet-door.js';
import { runningVersion } from './adapters/http/version.js';
import { checkDatabase, createPrismaClient } from './adapters/prisma/client.js';
import { createPrismaConnectionStore } from './adapters/prisma/connection-store.js';
import { createPrismaFleetForgetter } from './adapters/prisma/fleet-forgetter.js';
import { createPrismaFleetSwitches } from './adapters/prisma/fleet-switches.js';
import { createPrismaInstallationRequests } from './adapters/prisma/installation-requests.js';
import { createPrismaPartyStore } from './adapters/prisma/party-store.js';
import { gatewayRouter, type GatewayRouter } from './adapters/trpc/router.js';
import { createConnect } from './core/connection/connect.js';
import { createReadConnection, type ReadConnection } from './core/connection/read-connection.js';
import { createDeleteFleet } from './core/installation/delete-fleet.js';
import type { InstallationMode } from './core/installation/ports.js';
import { createReadFleet } from './core/installation/read-fleet.js';
import { createIsServed } from './core/installation/served.js';
import { createSetFleetEnabled } from './core/installation/set-fleet-enabled.js';
import { createAuthenticateOperator } from './core/operator/authenticate-operator.js';
import { createApproveParty } from './core/parties/approve-party.js';
import { createCrewParty } from './core/parties/crew-party.js';
import { createListParties } from './core/parties/list-parties.js';
import type { Clock } from './core/shared/clock.js';

export const systemClock: Clock = { now: () => new Date() };

/** The status Fastify answers while the database does not. */
const HTTP_SERVICE_UNAVAILABLE = 503;

export interface GatewayAppOptions {
  databaseUrl: string;
  fleetUrl: string;
  clock?: Clock;
  logger?: FastifyServerOptions['logger'];
  /** The installation token (decision 0021): unset, the installation is open and every fleet is served. */
  installationToken?: string;
}

export interface GatewayApp {
  /** The HTTP server: `/api/health` and `/api/version` for whoever operates the installation, and `/trpc`. */
  server: FastifyInstance;
  /** At start: reads every served fleet's kept connection, dropping a crew token its fleet no longer takes; answers each fleet still connected, as which ship. */
  restoreConnections: () => Promise<{ fleetId: FleetId; ship: string }[]>;
  /** Stops the server and disconnects the database. */
  close(): Promise<void>;
}

export function createGatewayApp(options: GatewayAppOptions): GatewayApp {
  const prisma = createPrismaClient(options.databaseUrl);
  const server = Fastify({ logger: options.logger ?? true });
  const connections = createPrismaConnectionStore(prisma);
  const installation: InstallationMode = options.installationToken === undefined ? 'open' : 'enabled';
  const switches = createPrismaFleetSwitches(prisma);
  const isServed = createIsServed({ installation, switches });

  // Only the version this process runs: no authentication, so nothing about its database or fleets.
  const version = runningVersion();
  server.get('/api/version', () => ({ gateway: version }));

  // Up and its database reachable; nothing about its installation or fleets.
  server.get('/api/health', async (_request, reply) => {
    try {
      await checkDatabase(prisma);
      return { status: 'ok' };
    } catch (error) {
      server.log.error({ err: error }, 'database unreachable');
      return reply.code(HTTP_SERVICE_UNAVAILABLE).send({ status: 'unavailable' });
    }
  });

  const clock = options.clock ?? systemClock;
  const door = createRestFleetDoor(options.fleetUrl);
  const readConnection = createReadConnection({ door, store: connections });
  // A fleet's connection as the gateway holds it, asking the fleet nothing: what a fleet that is off reads.
  const heldConnection: ReadConnection = async (fleetId) => {
    const crew = await connections.find(fleetId);
    if (crew) {
      return { state: 'connected', ship: { shipId: crew.shipId, name: crew.name }, lastShipId: crew.shipId };
    }
    return { state: 'not-connected', ship: null, lastShipId: (await connections.binding(fleetId))?.shipId ?? null };
  };
  const requests = createPrismaInstallationRequests(prisma);
  const setFleetEnabled = createSetFleetEnabled({ switches, requests, hasher: sha256RequestHasher, clock, connections, door });
  const readFleet = createReadFleet({ isServed, connections });
  const deleteFleet = createDeleteFleet({ forgetter: createPrismaFleetForgetter(prisma), requests, hasher: sha256RequestHasher, clock });
  const connect = createConnect({ door, store: connections, clock });
  const authenticateOperator = createAuthenticateOperator({ sessions: createFleetConsoleSessions(options.fleetUrl) });
  const parties = createPrismaPartyStore(prisma);
  const approveParty = createApproveParty({ connections, parties, door, hasher: sha256RequestHasher, clock });
  const crewParty = createCrewParty({ parties, door });
  const listParties = createListParties({ parties });

  const trpc: FastifyTRPCPluginOptions<GatewayRouter> = {
    prefix: '/trpc',
    trpcOptions: {
      router: gatewayRouter,
      onError: ({ error, path }) => {
        if (error.code === 'INTERNAL_SERVER_ERROR') {
          server.log.error({ err: error.cause ?? error, path }, 'procedure failed');
        }
      },
      createContext: ({ req }) => ({
        cookie: req.headers.cookie,
        authenticateOperator,
        isServed,
        heldConnection,
        installationTokenSent: typeof req.headers['x-aeolus-installation-token'] === 'string' ? req.headers['x-aeolus-installation-token'] : undefined,
        installation: { mode: installation, token: options.installationToken },
        setFleetEnabled,
        readFleet,
        deleteFleet,
        readConnection,
        connect,
        approveParty,
        crewParty,
        listParties,
      }),
    },
  };
  void server.register(fastifyTRPCPlugin, trpc);

  server.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  return {
    server,
    restoreConnections: async () => {
      const restored: { fleetId: FleetId; ship: string }[] = [];
      for (const crew of await connections.connected()) {
        // A fleet that is off is not read.
        const connection = (await isServed(crew.fleetId)) ? await readConnection(crew.fleetId) : await heldConnection(crew.fleetId);
        if (connection.state === 'connected') {
          restored.push({ fleetId: crew.fleetId, ship: connection.ship?.name ?? crew.name });
        }
      }
      return restored;
    },
    close: () => server.close(),
  };
}
