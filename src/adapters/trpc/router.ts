/**
 * The gateway's API: one tRPC router, which the console's server and the
 * gateway's page call with the console's session cookie, as the other
 * plugins' (decision 0043). Every procedure but the installation's is the
 * operator's: the cookie must be a signed-in console session of a fleet at
 * the fleet's URL, and the procedure works on that fleet. A fleet the gateway
 * does not serve (switched off) gets only `connection.status`. The
 * installation procedures take the installation token instead (decision 0021).
 */
import { timingSafeEqual } from 'node:crypto';

import { idempotencyKeySchema, idSchema, shipHandleSchema, type FleetId } from '@aeolus-fleet/common';
import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { Connect } from '../../core/connection/connect.js';
import type { ReadConnection } from '../../core/connection/read-connection.js';
import type { DeleteFleet } from '../../core/installation/delete-fleet.js';
import type { InstallationMode } from '../../core/installation/ports.js';
import type { ReadFleet } from '../../core/installation/read-fleet.js';
import type { IsServed } from '../../core/installation/served.js';
import type { SetFleetEnabled } from '../../core/installation/set-fleet-enabled.js';
import type { AuthenticateOperator } from '../../core/operator/authenticate-operator.js';
import type { ApproveParty } from '../../core/parties/approve-party.js';
import type { CrewParty } from '../../core/parties/crew-party.js';
import type { ListParties } from '../../core/parties/list-parties.js';
import type { MarkTool } from '../../core/mcp-out/mark-tool.js';
import type { StateParty } from '../../core/mcp-out/state-party.js';
import type { RegisterClient } from '../../core/oauth/register-client.js';

export interface Context {
  /** The Cookie header the console's server or the gateway's page forwarded. */
  cookie: string | undefined;
  authenticateOperator: AuthenticateOperator;
  isServed: IsServed;
  /** The fleet's connection as the gateway holds it, without asking the fleet: what a fleet that is off reads. */
  heldConnection: ReadConnection;
  /** The installation token header the caller sent, if any. */
  installationTokenSent: string | undefined;
  installation: { mode: InstallationMode; token: string | undefined };
  setFleetEnabled: SetFleetEnabled;
  readFleet: ReadFleet;
  deleteFleet: DeleteFleet;
  readConnection: ReadConnection;
  connect: Connect;
  approveParty: ApproveParty;
  crewParty: CrewParty;
  listParties: ListParties;
  stateParty: StateParty;
  markTool: MarkTool;
  registerClient: RegisterClient;
}

/** What a caller reads of a failure: nothing of it, so no crew token, secret or query ever leaves; the log holds it whole. */
export const INTERNAL_ERROR_MESSAGE = 'Internal error';

const t = initTRPC.context<Context>().create({
  isDev: false,
  errorFormatter: ({ shape, error }) => (error.code === 'INTERNAL_SERVER_ERROR' ? { ...shape, message: INTERNAL_ERROR_MESSAGE } : shape),
});

const operatorProcedure = t.procedure.use(async ({ ctx, next }) => {
  const operator = await ctx.authenticateOperator(ctx.cookie);
  if (!operator.isOk) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: operator.error.message });
  }
  return next({ ctx: { fleetId: operator.value.fleetId, scopes: operator.value.scopes } });
});

/**
 * What changes the fleet needs the session's ship to hold fleet:manage: argo
 * does, a viewer session (fleet:read only, decision 0022) does not, so it is
 * served reads only. Checked before the input is read.
 */
function managing(procedure: typeof operatorProcedure) {
  return procedure.use(({ ctx, next }) => {
    if (!ctx.scopes.includes('fleet:manage')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Needs fleet:manage: a viewer session only reads' });
    }
    return next();
  });
}

/** Whether the token sent is the installation token, compared in constant time. */
function isInstallationToken(sent: string | undefined, token: string): boolean {
  const expected = Buffer.from(token);
  const given = Buffer.from(sent ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The installation's procedures (decision 0021): with no installation token
 * configured they do not exist (NOT_FOUND); with one, the caller presents it
 * in `x-aeolus-installation-token` or is refused (UNAUTHORIZED).
 */
const installationProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (ctx.installation.mode === 'open' || ctx.installation.token === undefined) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'No such procedure' });
  }
  if (!isInstallationToken(ctx.installationTokenSent, ctx.installation.token)) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'The installation token is missing or wrong' });
  }
  return next();
});

/** Refuses a fleet the gateway does not serve: while it is off, FORBIDDEN. */
async function refuseUnlessServed(ctx: { fleetId: FleetId; isServed: IsServed }): Promise<void> {
  if (!(await ctx.isServed(ctx.fleetId))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'The gateway is off for this fleet' });
  }
}

/** The operator's procedures that need the gateway to serve their fleet. */
const servedProcedure = operatorProcedure.use(async ({ ctx, next }) => {
  await refuseUnlessServed(ctx);
  return next();
});

/** The refusals of connecting, as the API states them. */
const CONNECT_CODES = {
  ALREADY_CONNECTED: 'CONFLICT',
  SECRET_REFUSED: 'BAD_REQUEST',
  OTHER_FLEET: 'BAD_REQUEST',
  MISSING_SCOPES: 'BAD_REQUEST',
  NO_NETWORKING_PLUGIN: 'PRECONDITION_FAILED',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
} as const satisfies Record<string, TRPCError['code']>;

/** The refusals of switching a fleet, as the API states them: a fleet that does not answer is tried again with the same request id. */
const SET_ENABLED_CODES = {
  REQUEST_ID_USED: 'CONFLICT',
  NO_NETWORKING_PLUGIN: 'PRECONDITION_FAILED',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
} as const satisfies Record<string, TRPCError['code']>;

/** The refusals of approving a party, as the API states them: a fleet that does not answer is tried again with the same request id. */
const APPROVE_CODES = {
  NOT_CONNECTED: 'PRECONDITION_FAILED',
  PARTY_EXISTS: 'CONFLICT',
  COMMISSION_REFUSED: 'BAD_REQUEST',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
} as const satisfies Record<string, TRPCError['code']>;

/** The refusals of crewing a party's proxy ship with a new secret, as the API states them. */
const CREW_CODES = {
  NO_SUCH_PARTY: 'NOT_FOUND',
  NOT_AWAITING_CREW: 'CONFLICT',
  SECRET_REFUSED: 'BAD_REQUEST',
} as const satisfies Record<string, TRPCError['code']>;

/** The refusals of stating a party's proxy ship, as the API states them. */
const STATE_CODES = {
  NO_SUCH_PARTY: 'NOT_FOUND',
  NOT_CREWED: 'CONFLICT',
  SERVER_UNREACHABLE: 'BAD_GATEWAY',
  STATEMENT_REFUSED: 'BAD_REQUEST',
} as const satisfies Record<string, TRPCError['code']>;

/** The longest name argo gives an MCP client. */
const CLIENT_NAME_MAX_LENGTH = 200;

/** The longest tool name MCP allows (2026-07-28), as a capability's name is capped too. */
const TOOL_NAME_MAX_LENGTH = 128;

/** What stating a party answers: the names of the capabilities its proxy ship now offers. */
const statedOutputSchema = z.object({ capabilities: z.array(z.string()) });

/** The fewest and most calls the gateway has in flight to one party at once, and the default. */
const CONCURRENCY_LIMIT_MIN = 1;
// The most core 0.27's pushReceive hands at once, own deliveries in flight first (orchestrator-1 on aeolus-fleet#876, Q8).
const CONCURRENCY_LIMIT_MAX = 10;
const CONCURRENCY_LIMIT_DEFAULT = 4;

/** The credential argo gives the vault for a party: a static bearer, or OAuth client credentials. */
const credentialInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('bearer'), token: z.string().min(1) }),
  z.strictObject({
    kind: z.literal('clientCredentials'),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    issuer: z.url({ protocol: /^https?$/ }),
    scope: z.string().min(1).optional(),
  }),
]);

/** A party as argo reads it: never its credential or its crew token. */
const shownPartyBase = { name: z.string(), ownerShipId: z.string(), state: z.enum(['commissioning', 'awaitingCrew', 'crewed']), proxyShipId: z.string().nullable() };
const shownPartySchema = z.discriminatedUnion('kind', [
  z.object({ ...shownPartyBase, kind: z.literal('mcpServer'), url: z.string(), credentialKind: z.enum(['bearer', 'clientCredentials']), concurrencyLimit: z.int() }),
  z.object({ ...shownPartyBase, kind: z.literal('mcpClient'), clientId: z.string() }),
]);

/** The connection as the console reads it: whether the gateway serves the fleet, and its connection. */
const connectionStatusOutputSchema = z.object({
  enabled: z.boolean(),
  state: z.enum(['not-connected', 'connected']),
  ship: z.object({ shipId: z.string(), name: z.string() }).nullable(),
  lastShipId: z.string().nullable(),
});

export const gatewayRouter = t.router({
  connection: t.router({
    /** Whether the gateway is connected to the operator's fleet, as which ship, and the ship it was last connected as. */
    status: operatorProcedure.output(connectionStatusOutputSchema).query(async ({ ctx }) => {
      // A fleet that is off is read from what the gateway holds: it asks its fleet nothing then.
      const isServed = await ctx.isServed(ctx.fleetId);
      const connection = isServed ? await ctx.readConnection(ctx.fleetId) : await ctx.heldConnection(ctx.fleetId);
      return { enabled: isServed, ...connection };
    }),
    /**
     * Connects the gateway with its ship's secret, which the console's server
     * hands over server to server: it registers with it and keeps only the
     * crew token. Only while not connected, while the gateway serves the
     * fleet, and in a fleet with a registered networking plugin (interop I-3).
     */
    connect: managing(servedProcedure)
      .input(z.object({ shipId: idSchema('ship'), secret: z.string().min(1) }))
      .output(connectionStatusOutputSchema)
      .mutation(async ({ ctx, input }) => {
        const connected = await ctx.connect({ operatorFleetId: ctx.fleetId, ...input });
        if (!connected.isOk) {
          throw new TRPCError({ code: CONNECT_CODES[connected.error.kind], message: connected.error.message });
        }
        // Answered as connection.status answers: connect works only while the gateway serves the fleet.
        return { enabled: true, ...connected.value };
      }),
  }),
  parties: t.router({
    /** The parties argo approved for its fleet, by name. A viewer reads them too. */
    list: servedProcedure.output(z.array(shownPartySchema)).query(({ ctx }) => ctx.listParties(ctx.fleetId)),
    /**
     * argo approves an outside MCP server as a party: the gateway commissions
     * its app proxy ship owned by the owner argo picked, crews it, and keeps
     * the credential in its vault (interop I-5). A repeat with the same
     * request id picks up where the last one stopped.
     */
    approve: managing(servedProcedure)
      .input(
        z.strictObject({
          requestId: idempotencyKeySchema,
          name: shipHandleSchema,
          url: z.url({ protocol: /^https?$/ }),
          credential: credentialInputSchema,
          ownerShipId: idSchema('ship'),
          concurrencyLimit: z.int().min(CONCURRENCY_LIMIT_MIN).max(CONCURRENCY_LIMIT_MAX).default(CONCURRENCY_LIMIT_DEFAULT),
        }),
      )
      .output(shownPartySchema)
      .mutation(async ({ ctx, input }) => {
        const approved = await ctx.approveParty({ operatorFleetId: ctx.fleetId, ...input });
        if (!approved.isOk) {
          throw new TRPCError({ code: APPROVE_CODES[approved.error.kind], message: approved.error.message });
        }
        return approved.value;
      }),
    /** argo hands over a new secret, from a new starting prompt in the console, for a proxy ship that awaits crew. */
    crew: managing(servedProcedure)
      .input(z.strictObject({ name: shipHandleSchema, secret: z.string().min(1) }))
      .output(shownPartySchema)
      .mutation(async ({ ctx, input }) => {
        const crewed = await ctx.crewParty({ operatorFleetId: ctx.fleetId, ...input });
        if (!crewed.isOk) {
          throw new TRPCError({ code: CREW_CODES[crewed.error.kind], message: crewed.error.message });
        }
        return crewed.value;
      }),
    /** The gateway states the party's proxy ship anew, from what its server lists now, with argo's marks. */
    state: managing(servedProcedure)
      .input(z.strictObject({ name: shipHandleSchema }))
      .output(statedOutputSchema)
      .mutation(async ({ ctx, input }) => {
        const stated = await ctx.stateParty({ fleetId: ctx.fleetId, ...input });
        if (!stated.isOk) {
          throw new TRPCError({ code: STATE_CODES[stated.error.kind], message: stated.error.message });
        }
        return stated.value;
      }),
    /** argo marks a party's tool repeatable, or takes the mark off (interop 5.2): kept, then stated at once. */
    markTool: managing(servedProcedure)
      .input(z.strictObject({ name: shipHandleSchema, tool: z.string().min(1).max(TOOL_NAME_MAX_LENGTH), isRepeatable: z.boolean() }))
      .output(statedOutputSchema)
      .mutation(async ({ ctx, input }) => {
        const stated = await ctx.markTool({ fleetId: ctx.fleetId, ...input });
        if (!stated.isOk) {
          throw new TRPCError({ code: STATE_CODES[stated.error.kind], message: stated.error.message });
        }
        return stated.value;
      }),
  }),
  oauth: t.router({
    /**
     * argo pre-registers an MCP client for its fleet: its name and redirect
     * URIs, and whether it keeps a secret. The secret is answered this once.
     */
    registerClient: managing(operatorProcedure)
      .input(z.strictObject({ name: z.string().min(1).max(CLIENT_NAME_MAX_LENGTH), redirectUris: z.array(z.string()), isConfidential: z.boolean() }))
      .output(z.object({ clientId: z.string(), clientSecret: z.string().nullable() }))
      .mutation(async ({ ctx, input }) => {
        const registered = await ctx.registerClient({ fleetId: ctx.fleetId, ...input });
        if (!registered.isOk) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: registered.error.message });
        }
        return registered.value;
      }),
  }),
  installation: t.router({
    /** Switches the gateway on or off for a fleet; off keeps everything of it. A replayed request id answers its first answer. */
    setEnabled: installationProcedure
      .input(z.strictObject({ requestId: idempotencyKeySchema, fleetId: idSchema('fleet'), enabled: z.boolean() }))
      .output(z.object({ fleetId: z.string(), enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const set = await ctx.setFleetEnabled({ requestId: input.requestId, fleetId: input.fleetId, isEnabled: input.enabled });
        if (!set.isOk) {
          throw new TRPCError({ code: SET_ENABLED_CODES[set.error.kind], message: set.error.message });
        }
        return { fleetId: set.value.fleetId, enabled: set.value.isEnabled };
      }),
    /** Whether the gateway serves the fleet, and whether it is connected to it. */
    get: installationProcedure
      .input(z.strictObject({ fleetId: idSchema('fleet') }))
      .output(z.object({ enabled: z.boolean(), connected: z.boolean() }))
      .query(async ({ ctx, input }) => {
        const fleet = await ctx.readFleet({ fleetId: input.fleetId });
        return { enabled: fleet.isEnabled, connected: fleet.isConnected };
      }),
    /** Forgets everything the gateway holds of the fleet, telling the fleet nothing. A replayed request id answers its first answer. */
    delete: installationProcedure
      .input(z.strictObject({ requestId: idempotencyKeySchema, fleetId: idSchema('fleet') }))
      .output(z.strictObject({}))
      .mutation(async ({ ctx, input }) => {
        const deleted = await ctx.deleteFleet(input);
        if (!deleted.isOk) {
          throw new TRPCError({ code: 'CONFLICT', message: deleted.error.message });
        }
        return {};
      }),
  }),
});

export type GatewayRouter = typeof gatewayRouter;
