/**
 * The gateway's A2A endpoints for outside A2A clients (decision 0060), as
 * Fastify routes beside /mcp. Each alias has its public card, served to
 * anyone in the same shape, and its interface, where a client calls with
 * the bearer it was shown. The bearer names the party; the alias names a
 * ship the party's proxy ship reaches now, or the call is not found, the
 * same for an alias of no ship. While the fleet's outside parties are off,
 * every call with a bearer is refused. The SDK's JSON-RPC transport reads
 * the call; so far the gateway answers GetExtendedAgentCard and no other
 * method.
 */
import { AgentCard, type StreamResponse } from '@a2a-js/sdk';
import { UnsupportedOperationError } from '@a2a-js/sdk/errors';
import { JsonRpcTransportHandler, ServerCallContext, type A2ARequestHandler } from '@a2a-js/sdk/server';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { AuthenticateA2aClient } from '../../core/a2a-in/authenticate-a2a-client.js';
import type { FindReachedShip, FindReachedShipRefusal } from '../../core/a2a-in/find-reached-ship.js';
import type { ReachedShip } from '../../core/a2a-in/list-reached-ships.js';
import { A2A_PATH, ALIAS_PATTERN, extendedCardOf, publicCardOf } from './a2a-cards.js';

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_BAD_GATEWAY = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;

export interface A2aEndpointDeps {
  /** The gateway's public URL, which each card's interface is under. */
  issuer: string;
  authenticate: AuthenticateA2aClient;
  findReachedShip: FindReachedShip;
}

/** The HTTP status of each refusal of finding the ship, so an unknown and an unreachable alias answer alike. */
const FIND_STATUS = {
  UNKNOWN_ALIAS: HTTP_NOT_FOUND,
  PARTY_NOT_CREWED: HTTP_SERVICE_UNAVAILABLE,
  FLEET_UNAVAILABLE: HTTP_BAD_GATEWAY,
} as const satisfies Record<FindReachedShipRefusal['kind'], number>;

const aliasParamsSchema = z.object({ alias: z.string().regex(ALIAS_PATTERN) });
const requestIdSchema = z.object({ id: z.union([z.string(), z.number(), z.null()]) });

const unsupported = () => Promise.reject(new UnsupportedOperationError('This gateway does not carry this A2A method yet'));

/** A stream of a method not carried yet: it ends in its error before any event. */
async function* unsupportedStream(): AsyncGenerator<StreamResponse, void, undefined> {
  yield await unsupported();
}

/** The A2A methods for one call to one reached ship: its extended card, and none of the others yet. */
function requestHandlerFor(issuer: string, ship: ReachedShip): A2ARequestHandler {
  return {
    getAgentCard: () => Promise.resolve(publicCardOf(issuer, ship.alias)),
    getAuthenticatedExtendedAgentCard: () => Promise.resolve(extendedCardOf(issuer, ship)),
    sendMessage: unsupported,
    sendMessageStream: unsupportedStream,
    getTask: unsupported,
    cancelTask: unsupported,
    createTaskPushNotificationConfig: unsupported,
    getTaskPushNotificationConfig: unsupported,
    listTaskPushNotificationConfigs: unsupported,
    deleteTaskPushNotificationConfig: unsupported,
    resubscribe: unsupportedStream,
    listTasks: unsupported,
  };
}

/** The bearer an Authorization header carries, if it carries one. */
function bearerOf(authorization: string | undefined): string | undefined {
  return /^Bearer (\S+)$/i.exec(authorization ?? '')?.[1];
}

const notFound = (reply: FastifyReply) => reply.code(HTTP_NOT_FOUND).send({ error: 'No such agent' });

export function registerA2aEndpoint(server: FastifyInstance, deps: A2aEndpointDeps): void {
  server.get(`${A2A_PATH}/:alias/.well-known/agent-card.json`, async (request, reply) => {
    const params = aliasParamsSchema.safeParse(request.params);
    if (!params.success) {
      return notFound(reply);
    }
    return AgentCard.toJSON(publicCardOf(deps.issuer, params.data.alias));
  });

  server.post(`${A2A_PATH}/:alias`, async (request, reply) => {
    const params = aliasParamsSchema.safeParse(request.params);
    if (!params.success) {
      return notFound(reply);
    }
    const bearer = bearerOf(request.headers.authorization);
    if (bearer === undefined) {
      return reply.code(HTTP_UNAUTHORIZED).header('www-authenticate', 'Bearer').send({ error: 'Call with the bearer you were given' });
    }
    const caller = await deps.authenticate(bearer);
    if (!caller.isOk) {
      const status = caller.error.kind === 'OUTSIDE_PARTIES_OFF' ? HTTP_FORBIDDEN : HTTP_UNAUTHORIZED;
      return reply.code(status).header('www-authenticate', 'Bearer').send({ error: caller.error.message });
    }
    const ship = await deps.findReachedShip({ ...caller.value, alias: params.data.alias });
    if (!ship.isOk) {
      return reply.code(FIND_STATUS[ship.error.kind]).send({ error: ship.error.message });
    }
    const transport = new JsonRpcTransportHandler(requestHandlerFor(deps.issuer, ship.value));
    const requestedVersion = request.headers['a2a-version'];
    const answered = await transport.handle(z.record(z.string(), z.unknown()).catch({}).parse(request.body), new ServerCallContext(typeof requestedVersion === 'string' ? { requestedVersion } : {}));
    if (!(Symbol.asyncIterator in answered)) {
      return answered;
    }
    // Every stream ends in its error before any event, as no streaming method is carried yet.
    try {
      for await (const event of answered) {
        return event;
      }
      return await unsupported();
    } catch (error) {
      return { jsonrpc: '2.0', id: requestIdSchema.safeParse(request.body).data?.id ?? null, error: JsonRpcTransportHandler.mapToJSONRPCError(error) };
    }
  });
}
