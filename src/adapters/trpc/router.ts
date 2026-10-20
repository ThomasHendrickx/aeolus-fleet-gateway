/**
 * The gateway's API: one tRPC router, which the console's server and the
 * gateway's page call with the console's session cookie, as the other
 * plugins' (decision 0043), and any ship with its own crew token (decision
 * 0057). Every procedure but the installation's is an actor's: argo or a
 * viewer by a console session of a fleet at the fleet's URL, or a ship of a
 * fleet the gateway is connected to, and the procedure works on that fleet.
 * What it may call is the scopes the fleet holds for it. A fleet the gateway
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
import type { AuthenticateActor } from '../../core/actors/authenticate-actor.js';
import type { ReadOutsideParties, SetOutsideParties } from '../../core/outside-parties/set-outside-parties.js';
import type { ApproveParty } from '../../core/parties/approve-party.js';
import type { CrewParty } from '../../core/parties/crew-party.js';
import type { ListParties, ReadParty } from '../../core/parties/list-parties.js';
import type { RetireParty, RetirePartyRefusal } from '../../core/parties/retire-party.js';
import type { ChangePartyOwner, ChangePartyRefusal, ChangePartyScopes } from '../../core/parties/change-party.js';
import type { MarkTool } from '../../core/mcp-out/mark-tool.js';
import type { StateParty } from '../../core/mcp-out/state-party.js';
import type { CheckServer } from '../../core/parties/check-server.js';
import type { ReadPartyTools } from '../../core/parties/read-party-tools.js';
import type { RegisterClient } from '../../core/oauth/register-client.js';
import type { DecideRequest, DecideRefusal } from '../../core/requests/decide-request.js';
import type { ListMine } from '../../core/requests/list-mine.js';
import type { ListToDecide } from '../../core/requests/list-to-decide.js';
import type { EndSignIns } from '../../core/sign-in/end-sign-ins.js';
import type { PendingRequest } from '../../core/requests/ports.js';
import type { AnswerDelivery } from '../../core/people/answer-delivery.js';
import type { DoneDelivery } from '../../core/people/done-delivery.js';
import type { OpenDelivery } from '../../core/people/open-delivery.js';
import type { ReadInbox } from '../../core/people/read-inbox.js';
import type { Result } from '../../core/shared/result.js';

export interface Context {
  /** The Cookie header the console's server or the gateway's page forwarded. */
  cookie: string | undefined;
  /** The crew token a ship sent as its bearer token, if any. */
  crewToken: string | undefined;
  authenticateActor: AuthenticateActor;
  isServed: IsServed;
  /** The fleet's connection as the gateway holds it, without asking the fleet: what a fleet that is off reads. */
  heldConnection: ReadConnection;
  /** The installation token header the caller sent, if any. */
  installationTokenSent: string | undefined;
  installation: { mode: InstallationMode; token: string | undefined };
  setFleetEnabled: SetFleetEnabled;
  readFleet: ReadFleet;
  deleteFleet: DeleteFleet;
  endSignIns: EndSignIns;
  readConnection: ReadConnection;
  connect: Connect;
  approveParty: ApproveParty;
  crewParty: CrewParty;
  listParties: ListParties;
  retireParty: RetireParty;
  changePartyOwner: ChangePartyOwner;
  changePartyScopes: ChangePartyScopes;
  readParty: ReadParty;
  checkServer: CheckServer;
  readPartyTools: ReadPartyTools;
  stateParty: StateParty;
  markTool: MarkTool;
  registerClient: RegisterClient;
  listToDecide: ListToDecide;
  listMine: ListMine;
  decideRequest: DecideRequest;
  /** A person's own person ship's deliveries; unset where no pagasae signs anyone in. */
  person?: { readInbox: ReadInbox; openDelivery: OpenDelivery; answerDelivery: AnswerDelivery; doneDelivery: DoneDelivery };
  readOutsideParties: ReadOutsideParties;
  setOutsideParties: SetOutsideParties;
}

/** What a caller reads of a failure: nothing of it, so no crew token, secret or query ever leaves; the log holds it whole. */
export const INTERNAL_ERROR_MESSAGE = 'Internal error';

const t = initTRPC.context<Context>().create({
  isDev: false,
  errorFormatter: ({ shape, error }) => (error.code === 'INTERNAL_SERVER_ERROR' ? { ...shape, message: INTERNAL_ERROR_MESSAGE } : shape),
});

const actorProcedure = t.procedure.use(async ({ ctx, next }) => {
  const actor = await ctx.authenticateActor({ cookie: ctx.cookie, crewToken: ctx.crewToken });
  if (!actor.isOk) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: actor.error.message });
  }
  return next({ ctx: { actor: actor.value, fleetId: actor.value.fleetId, scopes: actor.value.scopes } });
});

/**
 * What changes the fleet needs the actor to hold fleet:manage: argo does, a
 * viewer session (fleet:read only, decision 0022) does not, so it is served
 * reads only; a ship as its scopes say. Checked before the input is read.
 */
function managing(procedure: typeof actorProcedure) {
  return procedure.use(({ ctx, next }) => {
    if (!ctx.scopes.includes('fleet:manage')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Needs fleet:manage' });
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
const servedProcedure = actorProcedure.use(async ({ ctx, next }) => {
  await refuseUnlessServed(ctx);
  return next();
});

/** The refusals of connecting, as the API states them. */
const CONNECT_CODES = {
  ALREADY_CONNECTED: 'CONFLICT',
  SECRET_REFUSED: 'BAD_REQUEST',
  OTHER_FLEET: 'BAD_REQUEST',
  MISSING_SCOPES: 'BAD_REQUEST',
  SCOPE_REFUSED: 'CONFLICT',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
} as const satisfies Record<string, TRPCError['code']>;

/** The refusals of switching a fleet, as the API states them: a fleet that does not answer is tried again with the same request id. */
const SET_ENABLED_CODES = {
  REQUEST_ID_USED: 'CONFLICT',
} as const satisfies Record<string, TRPCError['code']>;

/** The refusals of approving a party, as the API states them: a fleet that does not answer is tried again with the same request id. */
const APPROVE_CODES = {
  OUTSIDE_PARTIES_OFF: 'PRECONDITION_FAILED',
  NOT_CONNECTED: 'PRECONDITION_FAILED',
  PARTY_EXISTS: 'CONFLICT',
  COMMISSION_REFUSED: 'BAD_REQUEST',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
} as const satisfies Record<string, TRPCError['code']>;

/** The refusals of crewing a party's proxy ship with a new secret, as the API states them. */
/** The refusals of retiring a party, as the API states them. */
/** The refusals of changing a party's owner or scopes, as the API states them. */
const CHANGE_CODES = {
  SCOPE_NOT_HELD: 'FORBIDDEN',
  NO_SUCH_PARTY: 'NOT_FOUND',
  PARTY_NOT_COMMISSIONED: 'PRECONDITION_FAILED',
  CHANGE_REFUSED: 'FORBIDDEN',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
  NOT_AN_ACTOR: 'UNAUTHORIZED',
} as const satisfies Record<ChangePartyRefusal['kind'], TRPCError['code']>;

const RETIRE_CODES = {
  NOT_A_MANAGER: 'FORBIDDEN',
  NO_SUCH_PARTY: 'NOT_FOUND',
  RETIRE_REFUSED: 'FORBIDDEN',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
  NOT_AN_ACTOR: 'UNAUTHORIZED',
} as const satisfies Record<RetirePartyRefusal['kind'], TRPCError['code']>;

const CREW_CODES = {
  NO_SUCH_PARTY: 'NOT_FOUND',
  NOT_AWAITING_CREW: 'CONFLICT',
  SECRET_REFUSED: 'BAD_REQUEST',
} as const satisfies Record<string, TRPCError['code']>;

/** The refusals of reading an outside MCP server's tools, as the API states them. */
const TOOLS_CODES = {
  NO_SUCH_PARTY: 'NOT_FOUND',
  SERVER_UNREACHABLE: 'BAD_GATEWAY',
} as const satisfies Record<'NO_SUCH_PARTY' | 'SERVER_UNREACHABLE', TRPCError['code']>;

/** The refusals of checking an outside MCP server, as the API states them. */
const CHECK_CODES = {
  OUTSIDE_PARTIES_OFF: 'PRECONDITION_FAILED',
  SERVER_UNREACHABLE: 'BAD_GATEWAY',
} as const satisfies Record<'OUTSIDE_PARTIES_OFF' | 'SERVER_UNREACHABLE', TRPCError['code']>;

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

/** A party as any actor reads it: never its credential or its crew token. */
const shownPartyBase = { name: z.string(), state: z.enum(['commissioning', 'awaitingCrew', 'crewed']), proxyShipId: z.string().nullable() };
const shownPartySchema = z.discriminatedUnion('kind', [
  z.object({ ...shownPartyBase, kind: z.literal('mcpServer'), url: z.string(), credentialKind: z.enum(['bearer', 'clientCredentials']), concurrencyLimit: z.int() }),
  z.object({ ...shownPartyBase, kind: z.literal('mcpClient'), clientId: z.string() }),
]);

/** A party with its proxy ship's owner and scopes, read from the fleet (decision 0056): null while unknown. */
const fromFleet = { ownerShipId: z.string().nullable(), scopes: z.array(z.string()).nullable() };
const listedPartySchema = z.discriminatedUnion('kind', [
  z.object({ ...shownPartyBase, ...fromFleet, kind: z.literal('mcpServer'), url: z.string(), credentialKind: z.enum(['bearer', 'clientCredentials']), concurrencyLimit: z.int() }),
  z.object({ ...shownPartyBase, ...fromFleet, kind: z.literal('mcpClient'), clientId: z.string() }),
]);

/** The connection as the console reads it: whether the gateway serves the fleet, and its connection. */
const connectionStatusOutputSchema = z.object({
  enabled: z.boolean(),
  state: z.enum(['not-connected', 'connected']),
  ship: z.object({ shipId: z.string(), name: z.string() }).nullable(),
  lastShipId: z.string().nullable(),
});

/** The refusals of deciding a request, as the API states them. */
const DECIDE_CODES = {
  NOT_AN_APPROVER: 'FORBIDDEN',
  SCOPE_NOT_HELD: 'FORBIDDEN',
  NO_SUCH_REQUEST: 'NOT_FOUND',
  ALREADY_DECIDED: 'CONFLICT',
  EXPIRED: 'CONFLICT',
  CLIENT_HAS_PARTY: 'CONFLICT',
  PARTY_EXISTS: 'CONFLICT',
  SERVER_DETAILS_MISSING: 'BAD_REQUEST',
  COMMISSION_REFUSED: 'BAD_REQUEST',
  OUTSIDE_PARTIES_OFF: 'PRECONDITION_FAILED',
  NOT_CONNECTED: 'PRECONDITION_FAILED',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
} as const satisfies Record<DecideRefusal['kind'], TRPCError['code']>;

/** The refusals of switching outside parties, as the API states them: an open network's warning is confirmed by calling again. */
const OUTSIDE_PARTIES_CODES = {
  NOT_A_NETWORKER: 'FORBIDDEN',
  OPEN_NETWORK: 'PRECONDITION_FAILED',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
  NOT_AN_ACTOR: 'UNAUTHORIZED',
} as const satisfies Record<string, TRPCError['code']>;

/** A pending request as the API answers it: its times as ISO text. */
const pendingRequestSchema = z.object({
  fleetId: z.string(),
  requestId: z.string(),
  subject: z.discriminatedUnion('kind', [z.object({ kind: z.literal('client'), clientId: z.string(), clientName: z.string() }), z.object({ kind: z.literal('server'), url: z.string() })]),
  requesters: z.array(z.object({ accountId: z.string(), personShipId: z.string().nullable() })),
  askedAt: z.string(),
  expiresAt: z.string(),
  state: z.enum(['pending', 'approving', 'approved', 'denied', 'expired']),
  decidedBy: z.union([z.object({ kind: z.literal('ship'), shipId: z.string() }), z.object({ kind: z.literal('account'), accountId: z.string() }), z.object({ kind: z.enum(['operator', 'viewer']) })]).nullable(),
  decidedAt: z.string().nullable(),
});

function shownRequestOf(request: PendingRequest): z.infer<typeof pendingRequestSchema> {
  return { ...request, requesters: [...request.requesters], askedAt: request.askedAt.toISOString(), expiresAt: request.expiresAt.toISOString(), decidedAt: request.decidedAt?.toISOString() ?? null };
}

/** A decision as the API takes it: deny, or approve naming the proxy ship, its owner and its scopes, and for a server its credential. */
const decisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('deny') }),
  z.strictObject({
    kind: z.literal('approve'),
    party: z.strictObject({ name: shipHandleSchema, ownerShipId: idSchema('ship'), scopes: z.array(z.string()) }),
    server: z.strictObject({ credential: credentialInputSchema, concurrencyLimit: z.int().min(CONCURRENCY_LIMIT_MIN).max(CONCURRENCY_LIMIT_MAX) }).optional(),
  }),
]);

/** The largest payload a message carries. */
const PAYLOAD_MAX_BYTES = 64 * 1024;

/** The refusals of a person's own deliveries, as the API states them. */
const PERSON_CODES = {
  NOT_A_PERSON: 'FORBIDDEN',
  SIGNED_OUT: 'UNAUTHORIZED',
  FLEET_UNAVAILABLE: 'BAD_GATEWAY',
  NO_SUCH_DELIVERY: 'NOT_FOUND',
  SEND_REFUSED: 'BAD_REQUEST',
} as const satisfies Record<string, TRPCError['code']>;

function personAnswerOf<T>(answered: Result<T, { kind: keyof typeof PERSON_CODES; message: string }>): T {
  if (!answered.isOk) {
    throw new TRPCError({ code: PERSON_CODES[answered.error.kind], message: answered.error.message });
  }
  return answered.value;
}

/** A person signed in to the pages, acting on their own person ship: only an account has one. */
const personProcedure = actorProcedure.use(({ ctx, next }) => {
  if (ctx.actor.kind !== 'account' || ctx.person === undefined) {
    throw new TRPCError({ code: 'FORBIDDEN', message: "Only a person signed in to the gateway's pages has a person ship's deliveries here" });
  }
  return next({ ctx: { person: ctx.person, caller: { fleetId: ctx.actor.fleetId, grantId: ctx.actor.grantId } } });
});

export const gatewayRouter = t.router({
  connection: t.router({
    /** Whether the gateway is connected to the operator's fleet, as which ship, and the ship it was last connected as. */
    status: actorProcedure.output(connectionStatusOutputSchema).query(async ({ ctx }) => {
      // A fleet that is off is read from what the gateway holds: it asks its fleet nothing then.
      const isServed = await ctx.isServed(ctx.fleetId);
      const connection = isServed ? await ctx.readConnection(ctx.fleetId) : await ctx.heldConnection(ctx.fleetId);
      return { enabled: isServed, ...connection };
    }),
    /**
     * Connects the gateway with its ship's secret, which the console's server
     * hands over server to server: it registers with it and keeps only the
     * crew token. Only while not connected, and while the gateway serves the
     * fleet.
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
    /** The fleet's outside parties, by name, each with its proxy ship's owner and scopes from the fleet. Any actor reads them. */
    list: servedProcedure.output(z.array(listedPartySchema)).query(({ ctx }) => ctx.listParties(ctx.fleetId)),
    /** One outside party, as the list shows it. */
    get: servedProcedure
      .input(z.strictObject({ name: shipHandleSchema }))
      .output(listedPartySchema)
      .query(async ({ ctx, input }) => {
        const read = await ctx.readParty({ fleetId: ctx.fleetId, ...input });
        if (!read.isOk) {
          throw new TRPCError({ code: 'NOT_FOUND', message: read.error.message });
        }
        return read.value;
      }),
    /** An outside MCP server's tools, as the server lists them now, asked with the credential the gateway keeps. Any actor reads them. */
    tools: servedProcedure
      .input(z.strictObject({ name: shipHandleSchema }))
      .output(z.object({ tools: z.array(z.object({ name: z.string(), description: z.string().optional() })) }))
      .query(async ({ ctx, input }) => {
        const read = await ctx.readPartyTools({ fleetId: ctx.fleetId, ...input });
        if (!read.isOk) {
          throw new TRPCError({ code: TOOLS_CODES[read.error.kind], message: read.error.message });
        }
        return read.value;
      }),
    /**
     * An actor holding fleet:manage checks an outside MCP server before
     * approving it (F10): the tools it lists with the credential sent. The
     * gateway keeps nothing and commissions nothing. A mutation, so the
     * credential travels in the body, never in a URL.
     */
    check: managing(servedProcedure)
      .input(z.strictObject({ url: z.url({ protocol: /^https?$/ }), credential: credentialInputSchema }))
      .output(z.object({ tools: z.array(z.object({ name: z.string(), description: z.string().optional() })) }))
      .mutation(async ({ ctx, input }) => {
        const checked = await ctx.checkServer({ fleetId: ctx.fleetId, ...input });
        if (!checked.isOk) {
          throw new TRPCError({ code: CHECK_CODES[checked.error.kind], message: checked.error.message });
        }
        return checked.value;
      }),
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
        const approved = await ctx.approveParty({ operatorFleetId: ctx.fleetId, ...input, scopes: [] });
        if (!approved.isOk) {
          throw new TRPCError({ code: APPROVE_CODES[approved.error.kind], message: approved.error.message });
        }
        return approved.value;
      }),
    /**
     * An actor holding fleet:manage retires a party (decision 0056): its proxy
     * ship is retired in the fleet as the actor, within its manage reach, and
     * the gateway forgets the party. Adding it again is a new request.
     */
    /** An actor holding fleet:owner sets a party's owner: its proxy ship's, in the fleet, as the actor (decision 0056). */
    changeOwner: servedProcedure
      .input(z.strictObject({ name: shipHandleSchema, ownerShipId: idSchema('ship') }))
      .output(z.object({}))
      .mutation(async ({ ctx, input }) => {
        const changed = await ctx.changePartyOwner({ actor: ctx.actor, as: { cookie: ctx.cookie, crewToken: ctx.crewToken }, ...input });
        if (!changed.isOk) {
          throw new TRPCError({ code: CHANGE_CODES[changed.error.kind], message: changed.error.message });
        }
        return {};
      }),
    /** An actor holding scopes:grant grants and revokes a party's scopes, only scopes it holds: every scope its proxy ship holds now (decision 0056). */
    changeScopes: servedProcedure
      .input(z.strictObject({ name: shipHandleSchema, grant: z.array(z.string()), revoke: z.array(z.string()) }))
      .output(z.object({ scopes: z.array(z.string()) }))
      .mutation(async ({ ctx, input }) => {
        const changed = await ctx.changePartyScopes({ actor: ctx.actor, as: { cookie: ctx.cookie, crewToken: ctx.crewToken }, ...input });
        if (!changed.isOk) {
          throw new TRPCError({ code: CHANGE_CODES[changed.error.kind], message: changed.error.message });
        }
        return changed.value;
      }),
    retire: servedProcedure
      .input(z.strictObject({ name: shipHandleSchema }))
      .output(z.object({}))
      .mutation(async ({ ctx, input }) => {
        const retired = await ctx.retireParty({ actor: ctx.actor, as: { cookie: ctx.cookie, crewToken: ctx.crewToken }, ...input });
        if (!retired.isOk) {
          throw new TRPCError({ code: RETIRE_CODES[retired.error.kind], message: retired.error.message });
        }
        return {};
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
  people: t.router({
    /** What waits for the person's own ship, by titles only (Q20). */
    inbox: personProcedure.query(async ({ ctx }) => personAnswerOf(await ctx.person.readInbox(ctx.caller))),
    /** Opens one delivery, whole; the gateway acknowledges it for them. */
    open: personProcedure.input(z.strictObject({ deliveryId: z.string().min(1) })).mutation(async ({ ctx, input }) => personAnswerOf(await ctx.person.openDelivery({ caller: ctx.caller, ...input }))),
    /** Answers a delivery they opened, to its sender. */
    answer: personProcedure
      .input(z.strictObject({ deliveryId: z.string().min(1), contentType: z.string().min(1), payload: z.string().max(PAYLOAD_MAX_BYTES) }))
      .mutation(async ({ ctx, input }) => personAnswerOf(await ctx.person.answerDelivery({ caller: ctx.caller, ...input }))),
    /** Is done with a delivery they opened, with no answer. */
    done: personProcedure.input(z.strictObject({ deliveryId: z.string().min(1) })).mutation(async ({ ctx, input }) => personAnswerOf(await ctx.person.doneDelivery({ caller: ctx.caller, ...input }))),
  }),
  requests: t.router({
    /** The requests the account asked, in any state, the newest first (decision 0056: Your requests). */
    mine: actorProcedure.output(z.array(pendingRequestSchema)).query(async ({ ctx }) => {
      const listed = await ctx.listMine(ctx.actor);
      if (!listed.isOk) {
        throw new TRPCError({ code: 'FORBIDDEN', message: listed.error.message });
      }
      return listed.value.map(shownRequestOf);
    }),
    /** Every open request of the fleet, for an actor holding gateway:approve (decision 0056). */
    toDecide: servedProcedure.output(z.array(pendingRequestSchema)).query(async ({ ctx }) => {
      const listed = await ctx.listToDecide(ctx.actor);
      if (!listed.isOk) {
        throw new TRPCError({ code: 'FORBIDDEN', message: listed.error.message });
      }
      return listed.value.map(shownRequestOf);
    }),
    /** Decides a pending request as the actor: the first decision counts. */
    decide: servedProcedure
      .input(z.strictObject({ requestId: z.string().min(1), decision: decisionSchema }))
      .output(z.object({ state: z.enum(['approved', 'denied']), party: shownPartySchema.nullable() }))
      .mutation(async ({ ctx, input }) => {
        const decided = await ctx.decideRequest({ actor: ctx.actor, ...input });
        if (!decided.isOk) {
          throw new TRPCError({ code: DECIDE_CODES[decided.error.kind], message: decided.error.message });
        }
        return decided.value;
      }),
  }),
  outsideParties: t.router({
    /** Whether the fleet's outside parties are on (interop I-3). */
    status: servedProcedure.output(z.object({ isOn: z.boolean() })).query(({ ctx }) => ctx.readOutsideParties(ctx.actor)),
    /** Turns them on or off as an actor holding fleet:network; on in an open network needs its warning confirmed. */
    set: servedProcedure
      .input(z.strictObject({ isOn: z.boolean(), isOpenNetworkConfirmed: z.boolean() }))
      .output(z.object({ isOn: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const set = await ctx.setOutsideParties({ actor: ctx.actor, as: { cookie: ctx.cookie, crewToken: ctx.crewToken }, ...input });
        if (!set.isOk) {
          throw new TRPCError({ code: OUTSIDE_PARTIES_CODES[set.error.kind], message: set.error.message });
        }
        return set.value;
      }),
  }),
  oauth: t.router({
    /**
     * argo pre-registers an MCP client for its fleet: its name and redirect
     * URIs, and whether it keeps a secret. The secret is answered this once.
     */
    registerClient: managing(actorProcedure)
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
    /** pagasae disabled the account (decision 0055): every sign-in of it in the fleet ends, and its clients' tokens are revoked. Told again, it ends nothing more. */
    accountDisabled: installationProcedure
      .input(z.strictObject({ fleetId: idSchema('fleet'), accountId: z.string().min(1) }))
      .output(z.strictObject({}))
      .mutation(async ({ ctx, input }) => {
        await ctx.endSignIns(input);
        return {};
      }),
  }),
});

export type GatewayRouter = typeof gatewayRouter;
