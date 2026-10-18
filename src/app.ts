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
import { createPrismaToolMarks } from './adapters/prisma/tool-marks.js';
import { createMcpServers } from './adapters/mcp/mcp-servers.js';
import { createMarkTool } from './core/mcp-out/mark-tool.js';
import { createStateParty } from './core/mcp-out/state-party.js';
import { createHandCall } from './core/mcp-out/hand-call.js';
import { createRunParty } from './core/mcp-out/run-party.js';
import { createPrismaCalls } from './adapters/prisma/calls.js';
import { sleep } from './adapters/timers/sleep.js';
import { createPartyWorkers } from './party-workers.js';
import { gatewayRouter, type Context, type GatewayRouter } from './adapters/trpc/router.js';
import { registerPartiesPage } from './adapters/http/parties-page.js';
import { registerOAuthRoutes } from './adapters/http/oauth-routes.js';
import { oauthSecrets } from './adapters/crypto/oauth-secrets.js';
import { createClientMetadataDocuments } from './adapters/oauth/client-metadata-documents.js';
import { createPrismaAuthorizationCodes, createPrismaIssuedTokens, createPrismaOAuthClients } from './adapters/prisma/oauth-stores.js';
import { createApproveAuthorization } from './core/oauth/approve-authorization.js';
import { createExchangeToken } from './core/oauth/exchange-token.js';
import { createReadAuthorization } from './core/oauth/read-authorization.js';
import { createRegisterClient } from './core/oauth/register-client.js';
import { createConnect } from './core/connection/connect.js';
import { createReadConnection, type ReadConnection } from './core/connection/read-connection.js';
import { createDeleteFleet } from './core/installation/delete-fleet.js';
import type { InstallationMode } from './core/installation/ports.js';
import { createReadFleet } from './core/installation/read-fleet.js';
import { createIsServed } from './core/installation/served.js';
import { createSetFleetEnabled } from './core/installation/set-fleet-enabled.js';
import { createAuthenticateOperator } from './core/operator/authenticate-operator.js';
import { createApproveParty, type ApproveParty } from './core/parties/approve-party.js';
import { createCrewParty, type CrewParty } from './core/parties/crew-party.js';
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
  /** Where outside MCP clients reach the gateway: the OAuth issuer, with the MCP endpoint at /mcp. */
  publicUrl?: string;
  /** How long the gateway waits for an outside tool's answer before the call counts as unanswered: 5 minutes unless set. */
  toolCallTimeoutMs?: number;
}

/** Within the fleet's 10 minutes a handed delivery may wait for its confirmation (decision 0040). */
const TOOL_CALL_TIMEOUT_MS = 5 * 60_000;

/** Where the gateway is reached unless told: this machine, at its default port. */
const DEFAULT_PUBLIC_URL = 'http://127.0.0.1:4200';

/** How long a client's metadata document may take to answer. */
const CLIENT_METADATA_TIMEOUT_MS = 5_000;

/** How often a proxy ship's worker looks again while the fleet hands it only what it holds, or does not answer. */
const POLL_MS = 2_000;

/** How long a delivery answered again waits before it is handed with the next number, each longer than the last. */
const AGAIN_WAITS_MS = [1_000, 10_000, 60_000, 300_000];

export interface GatewayApp {
  /** The HTTP server: `/api/health` and `/api/version` for whoever operates the installation, and `/trpc`. */
  server: FastifyInstance;
  /**
   * At start: reads every served fleet's kept connection, dropping a crew
   * token its fleet no longer takes, and starts taking the calls of each
   * crewed party of a served fleet; answers each fleet still connected, as
   * which ship.
   */
  restoreConnections: () => Promise<{ fleetId: FleetId; ship: string }[]>;
  /** Stops taking calls, once those in flight ended, then stops the server and disconnects the database. */
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
  const marks = createPrismaToolMarks(prisma);
  const servers = createMcpServers();
  const stateParty = createStateParty({ parties, servers, door, marks });
  const markTool = createMarkTool({ parties, marks, stateParty });
  const handCall = createHandCall({ crew: door, servers, calls: createPrismaCalls(prisma), marks, timeoutMs: options.toolCallTimeoutMs ?? TOOL_CALL_TIMEOUT_MS });
  const workers = createPartyWorkers({ parties, stateParty, runParty: createRunParty({ crew: door, handCall, sleep, pollMs: POLL_MS, againWaitsMs: AGAIN_WAITS_MS }), log: server.log });
  const approvePartyOnly = createApproveParty({ connections, parties, door, hasher: sha256RequestHasher, clock });
  const crewPartyOnly = createCrewParty({ parties, door });
  // A party crewed by approving it, or by a new secret, has its calls taken at once.
  const approveParty: ApproveParty = async (input) => {
    const approved = await approvePartyOnly(input);
    if (approved.isOk) {
      await workers.start({ fleetId: input.operatorFleetId, name: approved.value.name });
    }
    return approved;
  };
  const crewParty: CrewParty = async (input) => {
    const crewed = await crewPartyOnly(input);
    if (crewed.isOk) {
      await workers.start({ fleetId: input.operatorFleetId, name: crewed.value.name });
    }
    return crewed;
  };
  const listParties = createListParties({ parties });

  // The OAuth server for outside MCP clients: the issuer is the public URL, and every token is bound to its MCP endpoint (RFC 8707).
  const issuer = options.publicUrl ?? DEFAULT_PUBLIC_URL;
  const resource = `${issuer}/mcp`;
  const oauthClients = createPrismaOAuthClients(prisma);
  const authorizationCodes = createPrismaAuthorizationCodes(prisma);
  const readAuthorization = createReadAuthorization({ clients: oauthClients, documents: createClientMetadataDocuments({ timeoutMs: CLIENT_METADATA_TIMEOUT_MS }), resource });
  const registerClient = createRegisterClient({ clients: oauthClients, secrets: oauthSecrets });
  registerOAuthRoutes(server, {
    issuer,
    resource,
    fleetUrl: options.fleetUrl,
    authenticateOperator,
    readAuthorization,
    approveAuthorization: createApproveAuthorization({ readAuthorization, codes: authorizationCodes, secrets: oauthSecrets, clock, issuer }),
    exchangeToken: createExchangeToken({ clients: oauthClients, codes: authorizationCodes, tokens: createPrismaIssuedTokens(prisma), secrets: oauthSecrets, clock, resource }),
  });

  // What every call of the API reads, from the request's console session and installation token.
  const contextFor = (sent: { cookie: string | undefined; installationTokenSent: string | undefined }): Context => ({
    ...sent,
    authenticateOperator,
    isServed,
    heldConnection,
    installation: { mode: installation, token: options.installationToken },
    setFleetEnabled,
    readFleet,
    deleteFleet,
    readConnection,
    connect,
    approveParty,
    crewParty,
    listParties,
    stateParty,
    markTool,
    registerClient,
  });

  const trpc: FastifyTRPCPluginOptions<GatewayRouter> = {
    prefix: '/trpc',
    trpcOptions: {
      router: gatewayRouter,
      onError: ({ error, path }) => {
        if (error.code === 'INTERNAL_SERVER_ERROR') {
          server.log.error({ err: error.cause ?? error, path }, 'procedure failed');
        }
      },
      createContext: ({ req }) =>
        contextFor({
          cookie: req.headers.cookie,
          installationTokenSent: typeof req.headers['x-aeolus-installation-token'] === 'string' ? req.headers['x-aeolus-installation-token'] : undefined,
        }),
    },
  };
  void server.register(fastifyTRPCPlugin, trpc);
  // The page calls the API as the caller, with the forwarded console session; it never takes the installation token.
  registerPartiesPage(server, { contextFor: (cookie) => contextFor({ cookie, installationTokenSent: undefined }), fleetUrl: options.fleetUrl });

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
      for (const party of await parties.crewed()) {
        if (await isServed(party.fleetId)) {
          await workers.start(party);
        }
      }
      return restored;
    },
    close: async () => {
      await workers.stop();
      await server.close();
    },
  };
}
