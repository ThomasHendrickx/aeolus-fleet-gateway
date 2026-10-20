/**
 * The gateway wired to its own database and to the fleet's public API. Its
 * API is the console's server's and its page's, with the console's session
 * cookie, and the hosting service's, with the installation token.
 */
import { randomUUID } from 'node:crypto';

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
import { registerOutsidePartiesPage } from './adapters/http/outside-parties-page.js';
import { createChangeHub, registerLive } from './adapters/http/live.js';
import { overviewLivePages, registerOverviewPage } from './adapters/http/overview-page.js';
import { listenToChanges } from './adapters/prisma/changes.js';
import { registerPartiesPage } from './adapters/http/parties-page.js';
import { registerOAuthRoutes } from './adapters/http/oauth-routes.js';
import { registerMcpEndpoint } from './adapters/http/mcp-endpoint.js';
import { createShipAliases } from './adapters/crypto/ship-aliases.js';
import { createListTools } from './core/mcp-in/list-tools.js';
import { createCallTool } from './core/mcp-in/call-tool.js';
import { createCollectReplies } from './core/mcp-in/collect-replies.js';
import { createReadClientCall } from './core/mcp-in/read-client-call.js';
import { createCallKeys } from './adapters/crypto/call-keys.js';
import { createPrismaClientCalls } from './adapters/prisma/client-calls.js';
import { createAuthenticateAccessToken } from './core/oauth/authenticate-access-token.js';
import { oauthSecrets } from './adapters/crypto/oauth-secrets.js';
import { createClientMetadataDocuments } from './adapters/oauth/client-metadata-documents.js';
import { createPrismaAuthorizationCodes, createPrismaIssuedTokens, createPrismaOAuthClients } from './adapters/prisma/oauth-stores.js';
import { createExchangeToken } from './core/oauth/exchange-token.js';
import { createSignInSeals } from './adapters/crypto/sign-in-seals.js';
import { createWaitingSeals } from './adapters/crypto/waiting-seals.js';
import { createRequestIds } from './adapters/crypto/request-ids.js';
import { createAskForClient } from './core/requests/ask-for-client.js';
import { createAskForServer } from './core/requests/ask-for-server.js';
import { createExpireRequests } from './core/requests/expire-requests.js';
import { createTellOutcomes } from './core/requests/tell-outcomes.js';
import { createAskOwners } from './core/requests/ask-owners.js';
import { createPrismaOwnerQuestions } from './adapters/prisma/owner-questions.js';
import type { DecideRequest } from './core/requests/decide-request.js';
import { createPrismaOutcomeNotices } from './adapters/prisma/outcome-notices.js';
import { createOutcomeWorker } from './outcome-worker.js';
import { createOpenRequest, type OpenRequest } from './core/requests/open-request.js';
import { createReadWaiting } from './core/requests/read-waiting.js';
import { createWatchWaiting } from './core/requests/watch-waiting.js';
import { createPagasae } from './adapters/pagasae/pagasae-client.js';
import { createPrismaAccountGrants } from './adapters/prisma/account-grants.js';
import { createCompleteSignIn } from './core/sign-in/complete-sign-in.js';
import { createStartSignIn } from './core/sign-in/start-sign-in.js';
import { createAccountTokenOf } from './core/sign-in/account-token.js';
import { createEndSignIns } from './core/sign-in/end-sign-ins.js';
import { createAnswerDelivery } from './core/people/answer-delivery.js';
import { createCrewPersonShip } from './core/people/crew-person-ship.js';
import { createDoneDelivery } from './core/people/done-delivery.js';
import { createOpenDelivery } from './core/people/open-delivery.js';
import { createReadInbox } from './core/people/read-inbox.js';
import { createPrismaOpenedDeliveries } from './adapters/prisma/opened-deliveries.js';
import { createPrismaPersonCrews } from './adapters/prisma/person-crews.js';
import { createReadAuthorization } from './core/oauth/read-authorization.js';
import { createRegisterClient } from './core/oauth/register-client.js';
import { createFleetNetwork } from './adapters/fleet/fleet-network.js';
import { createPrismaOutsidePartySwitches } from './adapters/prisma/outside-party-switches.js';
import { createReadOutsideParties, createSetOutsideParties, type SetOutsideParties } from './core/outside-parties/set-outside-parties.js';
import { createConnect } from './core/connection/connect.js';
import { createReadConnection, type ReadConnection } from './core/connection/read-connection.js';
import { createDeleteFleet } from './core/installation/delete-fleet.js';
import type { InstallationMode } from './core/installation/ports.js';
import { createReadFleet } from './core/installation/read-fleet.js';
import { createIsServed } from './core/installation/served.js';
import { createSetFleetEnabled } from './core/installation/set-fleet-enabled.js';
import { createAuthenticateOperator } from './core/operator/authenticate-operator.js';
import { createApproveClientParty, createApproveParty, type ApproveClientParty, type ApproveParty } from './core/parties/approve-party.js';
import { createCrewParty, type CrewParty } from './core/parties/crew-party.js';
import { createListParties } from './core/parties/list-parties.js';
import type { Clock } from './core/shared/clock.js';
import { createAuthenticateActor } from './core/actors/authenticate-actor.js';
import { createDecideRequest } from './core/requests/decide-request.js';
import { createListToDecide } from './core/requests/list-to-decide.js';
import { createPrismaPendingRequests } from './adapters/prisma/pending-requests.js';
import type { Pagasae } from './core/sign-in/ports.js';

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
  /** Keys ship aliases, result handles and idempotency keys: the same secret keeps every ship's alias across restarts. */
  gatewaySecret: string;
  /** How long an outside MCP client's call waits for its answer before it is answered its handle: 10 seconds unless set. */
  mcpWaitMaxMs?: number;
  /** How long the gateway waits for an outside tool's answer before the call counts as unanswered: 5 minutes unless set. */
  toolCallTimeoutMs?: number;
  /** pagasae, where people sign in, and the gateway's client there (decision 0054): unset, people do not sign in. */
  pagasae?: { url: string; clientId: string; clientSecret: string };
}

/** Within the fleet's 10 minutes a handed delivery may wait for its confirmation (decision 0040). */
const TOOL_CALL_TIMEOUT_MS = 5 * 60_000;

/** Where the gateway is reached unless told: this machine, at its default port. */
const DEFAULT_PUBLIC_URL = 'http://127.0.0.1:4200';

/** How long a client's metadata document may take to answer. */
const CLIENT_METADATA_TIMEOUT_MS = 5_000;

/** How long pagasae's token endpoint may take to answer. */
const PAGASAE_TIMEOUT_MS = 10_000;

/** How a ship sends its own crew token to the gateway's API: as a bearer token (decision 0057). */
const BEARER = 'Bearer ';

/** How often a proxy ship's worker looks again while the fleet hands it only what it holds, or does not answer. */
const POLL_MS = 2_000;

/** How often the gateway expires due requests and tells outcomes still to tell (P5-1 a). */
const OUTCOME_ROUND_MS = 60_000;

/** How long an outside client's call waits for its answer before it fails: the fleet's 10 minutes for a handed delivery, while statements state no deadline. */
const CLIENT_CALL_DEADLINE_MS = 10 * 60_000;

/** How long an outside MCP client's call waits for its answer unless told. */
const MCP_WAIT_MAX_MS = 10_000;

/** How often a waiting call is read for its answer. */
const MCP_WAIT_POLL_MS = 200;

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
  const setFleetEnabled = createSetFleetEnabled({ switches, requests, hasher: sha256RequestHasher, clock });
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
  const clientCalls = createPrismaClientCalls(prisma);
  const outsidePartySwitches = createPrismaOutsidePartySwitches(prisma);
  const servesOutsideParties = (fleetId: FleetId) => outsidePartySwitches.isOn(fleetId);
  const workers = createPartyWorkers({
    parties,
    stateParty,
    runParty: createRunParty({ crew: door, handCall, sleep, pollMs: POLL_MS, againWaitsMs: AGAIN_WAITS_MS }),
    collectReplies: createCollectReplies({ crew: door, calls: clientCalls, clock, sleep, pollMs: POLL_MS }),
    servesOutsideParties,
    log: server.log,
  });
  const approvePartyOnly = createApproveParty({ connections, parties, door, hasher: sha256RequestHasher, servesOutsideParties, clock });
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
  const approveClientPartyOnly = createApproveClientParty({ connections, parties, door, hasher: sha256RequestHasher, servesOutsideParties, clock });
  // A client party crewed at its first approval has the replies to its calls taken at once.
  const approveClientParty: ApproveClientParty = async (input) => {
    const approved = await approveClientPartyOnly(input);
    if (approved.isOk) {
      await workers.start({ fleetId: input.operatorFleetId, name: approved.value.name });
    }
    return approved;
  };
  const listParties = createListParties({ parties });
  const setOutsidePartiesOnly = createSetOutsideParties({ switches: outsidePartySwitches, network: createFleetNetwork(options.fleetUrl), clock });
  // Off stops the fleet's workers; on starts its crewed parties' workers again.
  const setOutsideParties: SetOutsideParties = async (input) => {
    const set = await setOutsidePartiesOnly(input);
    if (set.isOk && !set.value.isOn) {
      await workers.stopFleet(input.actor.fleetId);
    }
    if (set.isOk && set.value.isOn) {
      for (const party of await parties.crewed()) {
        if (party.fleetId === input.actor.fleetId) {
          await workers.start(party);
        }
      }
    }
    return set;
  };

  // The OAuth server for outside MCP clients: the issuer is the public URL, and every token is bound to its MCP endpoint (RFC 8707).
  const issuer = options.publicUrl ?? DEFAULT_PUBLIC_URL;
  const resource = `${issuer}/mcp`;
  const oauthClients = createPrismaOAuthClients(prisma);
  const authorizationCodes = createPrismaAuthorizationCodes(prisma);
  const readAuthorization = createReadAuthorization({ clients: oauthClients, documents: createClientMetadataDocuments({ timeoutMs: CLIENT_METADATA_TIMEOUT_MS }), resource });
  const registerClient = createRegisterClient({ clients: oauthClients, secrets: oauthSecrets });
  const issuedTokens = createPrismaIssuedTokens(prisma);
  const seals = createSignInSeals(options.gatewaySecret);
  // People sign in through pagasae where it is set (decision 0054); else no client connects, as only an account asks for one (A a).
  const pagasae = options.pagasae === undefined ? undefined : createPagasae({ ...options.pagasae, redirectUri: `${issuer}/pagasae/callback`, timeoutMs: PAGASAE_TIMEOUT_MS });
  const grants = createPrismaAccountGrants(prisma);
  const pendingRequests = createPrismaPendingRequests(prisma);
  const waitings = createWaitingSeals(options.gatewaySecret);
  const issuing = { codes: authorizationCodes, secrets: oauthSecrets, clock, issuer };
  const openRequestOnly = createOpenRequest({ requests: pendingRequests, ids: createRequestIds(), clock });
  // A request opened has the gateway's owner asked at once, not at the next round.
  const openRequest: OpenRequest = async (asked) => {
    const opened = await openRequestOnly(asked);
    outcomes.tellNow();
    return opened;
  };
  // The live pages hear each committed change to the fleet's requests, from whichever gateway made it.
  const hub = createChangeHub();
  const signIn =
    pagasae === undefined
      ? undefined
      : {
          start: createStartSignIn({ readAuthorization, seals, pagasae, secrets: oauthSecrets, clock }),
          complete: createCompleteSignIn({
            readAuthorization,
            seals,
            pagasae,
            grants,
            codes: authorizationCodes,
            secrets: oauthSecrets,
            clock,
            issuer,
            servesFleet: async (fleetId) => (await connections.find(fleetId)) !== undefined && (await isServed(fleetId)),
            askForClient: createAskForClient({
              parties,
              requests: pendingRequests,
              openRequest,
              servesOutsideParties,
              waitings,
              ...issuing,
            }),
          }),
          readWaiting: createReadWaiting({ waitings, readAuthorization, requests: pendingRequests, parties, ...issuing }),
          watchWaiting: createWatchWaiting({ waitings, requests: pendingRequests, parties, clock }),
          hub,
        };
  registerOAuthRoutes(server, {
    ...(signIn === undefined ? {} : { signIn }),
    issuer,
    resource,
    readAuthorization,
    exchangeToken: createExchangeToken({ clients: oauthClients, codes: authorizationCodes, tokens: issuedTokens, secrets: oauthSecrets, clock, resource }),
  });
  // A signed-in person's messaging, as the crew of their person ship (decision 0057).
  const personToolsOf = (signedIn: { pagasae: Pagasae }) => {
    const crews = createPrismaPersonCrews(prisma);
    const opened = createPrismaOpenedDeliveries(prisma);
    const accountTokenOf = createAccountTokenOf({ grants, tokens: issuedTokens, pagasae: signedIn.pagasae, clock });
    const asCrew = { crewPersonShip: createCrewPersonShip({ accountTokenOf, connections, door, crews, clock }), crews, door: door.person };
    return {
      readInbox: createReadInbox(asCrew),
      openDelivery: createOpenDelivery({ ...asCrew, opened, clock }),
      answerDelivery: createAnswerDelivery({ ...asCrew, opened }),
      doneDelivery: createDoneDelivery({ ...asCrew, opened }),
      askForServer: createAskForServer({ grants, parties, openRequest, servesOutsideParties }),
    };
  };
  const person = pagasae === undefined ? undefined : personToolsOf({ pagasae });
  const listTools = createListTools({ parties, discovery: door, aliases: createShipAliases(options.gatewaySecret) });
  registerMcpEndpoint(server, {
    resource,
    authenticateAccessToken: createAuthenticateAccessToken({ tokens: issuedTokens, secrets: oauthSecrets, clock, resource }),
    listTools,
    callTool: createCallTool({ parties, listTools, sender: door, calls: clientCalls, keys: createCallKeys(options.gatewaySecret), clock, deadlineMs: CLIENT_CALL_DEADLINE_MS, sleep, waitMs: options.mcpWaitMaxMs ?? MCP_WAIT_MAX_MS, waitPollMs: MCP_WAIT_POLL_MS }),
    readClientCall: createReadClientCall({ calls: clientCalls, clock }),
    servesOutsideParties,
    ...(person === undefined ? {} : { person }),
  });

  // What every call of the API reads, from the request's console session and installation token.
  const authenticateActor = createAuthenticateActor({ authenticateOperator, door, connections });
  const outcomes = createOutcomeWorker({
    expireRequests: createExpireRequests({ requests: pendingRequests, clock }),
    tellOutcomes: createTellOutcomes({ notices: createPrismaOutcomeNotices(prisma), requests: pendingRequests, connections, sender: door }),
    askOwners: createAskOwners({ questions: createPrismaOwnerQuestions(prisma), connections, owners: door, sender: door, newQuestionId: randomUUID, clock, overviewUrl: `${issuer}/overview` }),
    sleep,
    intervalMs: OUTCOME_ROUND_MS,
    log: server.log,
  });
  const decideRequestOnly = createDecideRequest({ requests: pendingRequests, approveParty, approveClientParty, clock });
  // A decided request's outcomes are told at once, not at the next round.
  const decideRequest: DecideRequest = async (input) => {
    const decided = await decideRequestOnly(input);
    if (decided.isOk) {
      outcomes.tellNow();
    }
    return decided;
  };
  const contextFor = (sent: { cookie: string | undefined; crewToken: string | undefined; installationTokenSent: string | undefined }): Context => ({
    ...sent,
    authenticateActor,
    isServed,
    heldConnection,
    installation: { mode: installation, token: options.installationToken },
    setFleetEnabled,
    readFleet,
    deleteFleet,
    endSignIns: createEndSignIns({ grants, tokens: issuedTokens }),
    readConnection,
    connect,
    approveParty,
    crewParty,
    listParties,
    stateParty,
    markTool,
    readOutsideParties: createReadOutsideParties({ switches: outsidePartySwitches }),
    setOutsideParties,
    registerClient,
    listToDecide: createListToDecide({ requests: pendingRequests, clock }),
    decideRequest,
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
          crewToken: req.headers.authorization?.startsWith(BEARER) === true ? req.headers.authorization.slice(BEARER.length) : undefined,
          installationTokenSent: typeof req.headers['x-aeolus-installation-token'] === 'string' ? req.headers['x-aeolus-installation-token'] : undefined,
        }),
    },
  };
  void server.register(fastifyTRPCPlugin, trpc);
  // The page calls the API as the caller, with the forwarded console session; it never takes the installation token.
  const pageContextFor = (cookie: string | undefined) => contextFor({ cookie, crewToken: undefined, installationTokenSent: undefined });
  registerPartiesPage(server, { contextFor: pageContextFor, fleetUrl: options.fleetUrl });
  registerOutsidePartiesPage(server, { contextFor: pageContextFor, fleetUrl: options.fleetUrl });
  registerOverviewPage(server, { contextFor: pageContextFor, fleetUrl: options.fleetUrl, clock });

  registerLive(server, { contextFor: pageContextFor, hub, pages: overviewLivePages({ clock }) });
  let changes: { close(): Promise<void> } | undefined;
  server.addHook('onReady', async () => {
    changes = await listenToChanges(options.databaseUrl, { onChange: hub.publish, onResync: hub.resync });
  });

  server.addHook('onClose', async () => {
    await changes?.close();
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
      outcomes.start();
      return restored;
    },
    close: async () => {
      await outcomes.stop();
      await workers.stop();
      await server.close();
    },
  };
}
