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

import { idempotencyKeySchema, idSchema, type FleetId } from '@aeolus-fleet/common';
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
