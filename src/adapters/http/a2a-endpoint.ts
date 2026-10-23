/**
 * The gateway's A2A endpoints for outside A2A clients (decision 0060), as
 * Fastify routes beside /mcp. Each alias has its public card, served to
 * anyone in the same shape, and its interface, where a client calls with
 * the bearer it was shown. The bearer names the party; the alias names a
 * ship the party's proxy ship reaches now, or the call is not found, the
 * same for an alias of no ship. While the fleet's outside parties are off,
 * every call with a bearer is refused. The SDK reads the call over
 * JSON-RPC and HTTP+JSON; the gateway answers GetExtendedAgentCard,
 * SendMessage, GetTask, ListTasks and CancelTask, and no other method.
 */
import { AgentCard, GetTaskRequest, ListTasksRequest, ListTasksResponse, SendMessageRequest, SendMessageResponse, Task, type StreamResponse } from '@a2a-js/sdk';
import { ContentTypeNotSupportedError, RequestMalformedError, TaskNotCancelableError, TaskNotFoundError, UnsupportedOperationError, restStatusFor, toRestErrorBody } from '@a2a-js/sdk/errors';
import { JsonRpcTransportHandler, ServerCallContext, validateVersion, type A2ARequestHandler } from '@a2a-js/sdk/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { A2aCaller, AuthenticateA2aClient } from '../../core/a2a-in/authenticate-a2a-client.js';
import { isOfEssence } from '../../core/mcp-in/client-call.js';
import type { FindReachedShip, FindReachedShipRefusal } from '../../core/a2a-in/find-reached-ship.js';
import type { ListA2aTasks } from '../../core/a2a-in/list-a2a-tasks.js';
import type { ReachedShip } from '../../core/a2a-in/list-reached-ships.js';
import type { ReadA2aTask } from '../../core/a2a-in/read-a2a-task.js';
import type { SendA2aMessage, SendA2aMessageRefusal } from '../../core/a2a-in/send-a2a-message.js';
import { A2A_PATH, ALIAS_PATTERN, extendedCardOf, publicCardOf } from './a2a-cards.js';
import { inboundMessageOf, taskOf } from './a2a-tasks.js';

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_UNSUPPORTED_MEDIA_TYPE = 415;
const HTTP_BAD_GATEWAY = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;

/** The media type of A2A's HTTP+JSON binding, which a client may send its body as. */
const A2A_MEDIA_TYPE = 'application/a2a+json';
/** The media types a call's body comes as: JSON, or A2A's own for HTTP+JSON. */
const REST_MEDIA_TYPES = ['application/json', A2A_MEDIA_TYPE];

export interface A2aEndpointDeps {
  /** The gateway's public URL, which each card's interface is under. */
  issuer: string;
  authenticate: AuthenticateA2aClient;
  findReachedShip: FindReachedShip;
  sendMessage: SendA2aMessage;
  readTask: ReadA2aTask;
  listTasks: ListA2aTasks;
}

/** The HTTP status of each refusal of finding the ship, so an unknown and an unreachable alias answer alike. */
const FIND_STATUS = {
  UNKNOWN_ALIAS: HTTP_NOT_FOUND,
  PARTY_NOT_CREWED: HTTP_SERVICE_UNAVAILABLE,
  FLEET_UNAVAILABLE: HTTP_BAD_GATEWAY,
} as const satisfies Record<FindReachedShipRefusal['kind'], number>;

const aliasParamsSchema = z.object({ alias: z.string().regex(ALIAS_PATTERN) });
const taskParamsSchema = z.object({ taskId: z.string() });
/** A task's method in the HTTP+JSON binding, as `<taskId>:<method>`: Fastify reads no colon after a parameter. */
const TASK_METHOD = /^(?<taskId>.+):(?<method>[a-z]+)$/i;
const requestIdSchema = z.object({ id: z.union([z.string(), z.number(), z.null()]) });
const querySchema = z.record(z.string(), z.unknown()).catch({});

const unsupported = () => Promise.reject(new UnsupportedOperationError('This gateway does not carry this A2A method'));

/** A stream of a method not carried: it ends in its error before any event. */
async function* unsupportedStream(): AsyncGenerator<StreamResponse, void, undefined> {
  yield await unsupported();
}

/**
 * The A2A error of a refused send. The fleet's own refusals are no A2A
 * error, so they answer as the agent's internal error, with what to do.
 */
function errorOf(refusal: SendA2aMessageRefusal): Error {
  switch (refusal.kind) {
    case 'UNKNOWN_ALIAS':
    case 'TASK_NOT_FOUND':
      return new TaskNotFoundError(refusal.message);
    case 'TASK_TERMINAL':
      return new UnsupportedOperationError(refusal.message);
    case 'PAYLOAD_TOO_LARGE':
    case 'CONTEXT_MISMATCH':
      return new RequestMalformedError(refusal.message);
    case 'PARTY_NOT_CREWED':
    case 'FLEET_UNAVAILABLE':
    case 'NOT_REACHABLE':
    case 'SEND_REFUSED':
      return new Error(refusal.message);
  }
}

/** The A2A methods for one caller's call to one reached ship: its extended card, and its tasks. */
function requestHandlerFor(deps: A2aEndpointDeps, { caller, ship }: { caller: A2aCaller; ship: ReachedShip }): A2ARequestHandler {
  const read = async (taskId: string) => {
    const task = await deps.readTask(caller, taskId);
    if (!task.isOk) {
      throw new TaskNotFoundError(task.error.message);
    }
    return task.value;
  };
  return {
    getAgentCard: () => Promise.resolve(publicCardOf(deps.issuer, ship.alias)),
    getAuthenticatedExtendedAgentCard: () => Promise.resolve(extendedCardOf(deps.issuer, ship)),
    sendMessage: async ({ message, configuration }) => {
      if (message === undefined) {
        throw new RequestMalformedError('Send a message');
      }
      const sent = await deps.sendMessage({ caller, alias: ship.alias, message: inboundMessageOf(message), isBlocking: configuration?.returnImmediately !== true });
      if (!sent.isOk) {
        throw errorOf(sent.error);
      }
      return taskOf(sent.value, configuration?.historyLength === undefined ? {} : { historyLength: configuration.historyLength });
    },
    sendMessageStream: unsupportedStream,
    getTask: async ({ id, historyLength }) => taskOf(await read(id), historyLength === undefined ? {} : { historyLength }),
    // A8: a ship's work is not the gateway's to stop.
    cancelTask: async ({ id }) => {
      await read(id);
      throw new TaskNotCancelableError(`The task ${id} cannot be canceled`);
    },
    createTaskPushNotificationConfig: unsupported,
    getTaskPushNotificationConfig: unsupported,
    listTaskPushNotificationConfigs: unsupported,
    deleteTaskPushNotificationConfig: unsupported,
    resubscribe: unsupportedStream,
    listTasks: async ({ pageSize, pageToken, contextId, historyLength, includeArtifacts }) => {
      const page = await deps.listTasks(caller, { ...(pageSize === undefined ? {} : { pageSize }), pageToken, contextId });
      const options = { isWithoutArtifacts: includeArtifacts !== true, ...(historyLength === undefined ? {} : { historyLength }) };
      return { tasks: page.tasks.map((task) => taskOf(task, options)), nextPageToken: page.next ?? '', pageSize: page.pageSize, totalSize: page.tasks.length };
    },
  };
}

/** The HTTP status of an A2A error: A2A 1.0's 409 and 415 where the SDK answers 400. */
function restStatusOf(error: unknown): number {
  if (error instanceof TaskNotCancelableError) {
    return HTTP_CONFLICT;
  }
  return error instanceof ContentTypeNotSupportedError ? HTTP_UNSUPPORTED_MEDIA_TYPE : restStatusFor(error);
}

/** The bearer an Authorization header carries, if it carries one. */
function bearerOf(authorization: string | undefined): string | undefined {
  return /^Bearer (\S+)$/i.exec(authorization ?? '')?.[1];
}

const notFound = (reply: FastifyReply) => reply.code(HTTP_NOT_FOUND).send({ error: 'No such agent' });

/** The call's context, with the A2A version it asked for: none read as 0.3, which the gateway does not speak. */
function contextOf(request: FastifyRequest): ServerCallContext {
  const requestedVersion = request.headers['a2a-version'];
  return new ServerCallContext(typeof requestedVersion === 'string' ? { requestedVersion } : {});
}

export function registerA2aEndpoint(server: FastifyInstance, deps: A2aEndpointDeps): void {
  if (!server.hasContentTypeParser(A2A_MEDIA_TYPE)) {
    server.addContentTypeParser(A2A_MEDIA_TYPE, { parseAs: 'string' }, server.getDefaultJsonParser('error', 'error'));
  }

  server.get(`${A2A_PATH}/:alias/.well-known/agent-card.json`, async (request, reply) => {
    const params = aliasParamsSchema.safeParse(request.params);
    if (!params.success) {
      return notFound(reply);
    }
    return AgentCard.toJSON(publicCardOf(deps.issuer, params.data.alias));
  });

  /** The caller and the ship its alias names, or the reply already refused. */
  const resolve = async (request: FastifyRequest, reply: FastifyReply): Promise<{ caller: A2aCaller; ship: ReachedShip } | undefined> => {
    const params = aliasParamsSchema.safeParse(request.params);
    if (!params.success) {
      await notFound(reply);
      return undefined;
    }
    const bearer = bearerOf(request.headers.authorization);
    if (bearer === undefined) {
      await reply.code(HTTP_UNAUTHORIZED).header('www-authenticate', 'Bearer').send({ error: 'Call with the bearer you were given' });
      return undefined;
    }
    const caller = await deps.authenticate(bearer);
    if (!caller.isOk) {
      const status = caller.error.kind === 'OUTSIDE_PARTIES_OFF' ? HTTP_FORBIDDEN : HTTP_UNAUTHORIZED;
      await reply.code(status).header('www-authenticate', 'Bearer').send({ error: caller.error.message });
      return undefined;
    }
    const ship = await deps.findReachedShip({ ...caller.value, alias: params.data.alias });
    if (!ship.isOk) {
      await reply.code(FIND_STATUS[ship.error.kind]).send({ error: ship.error.message });
      return undefined;
    }
    return { caller: caller.value, ship: ship.value };
  };

  void server.register((calls) => {
    registerCalls(calls, { deps, resolve });
    return Promise.resolve();
  });
}

/** Whether the call's body is JSON, as both bindings take it: no body counts, as a POST with no body (CancelTask) may say JSON or nothing. */
function isJsonBody(request: FastifyRequest): boolean {
  const contentType = request.headers['content-type'];
  return contentType === undefined || REST_MEDIA_TYPES.some((mediaType) => isOfEssence(contentType, mediaType));
}

/**
 * The calls of both bindings, in a scope of their own: there a JSON body may
 * be empty (CancelTask), and a body of any other content type is kept as
 * text, so the call answers ContentTypeNotSupportedError and sends nothing.
 */
function registerCalls(server: FastifyInstance, { deps, resolve }: { deps: A2aEndpointDeps; resolve: (request: FastifyRequest, reply: FastifyReply) => Promise<{ caller: A2aCaller; ship: ReachedShip } | undefined> }): void {
  const parseJson = server.getDefaultJsonParser('error', 'error');
  server.removeAllContentTypeParsers();
  for (const mediaType of REST_MEDIA_TYPES) {
    server.addContentTypeParser(mediaType, { parseAs: 'string' }, (request: FastifyRequest, body: string | Buffer) => {
      const text = typeof body === 'string' ? body : body.toString('utf8');
      return new Promise((resolve, reject) => {
        if (text === '') {
          resolve(undefined);
          return;
        }
        void parseJson(request, text, (error, parsed) => {
          if (error === null) {
            resolve(parsed);
          } else {
            reject(error);
          }
        });
      });
    });
  }
  server.addContentTypeParser('*', { parseAs: 'string' }, (_request: FastifyRequest, body: string | Buffer) => Promise.resolve(typeof body === 'string' ? body : body.toString('utf8')));
  const notSupported = () => new ContentTypeNotSupportedError('Send the body as application/json');

  server.post(`${A2A_PATH}/:alias`, async (request, reply) => {
    const resolved = await resolve(request, reply);
    if (resolved === undefined) {
      return reply;
    }
    const id = requestIdSchema.safeParse(request.body).data?.id ?? null;
    if (!isJsonBody(request)) {
      return { jsonrpc: '2.0', id, error: JsonRpcTransportHandler.mapToJSONRPCError(notSupported()) };
    }
    const context = contextOf(request);
    try {
      validateVersion(context.requestedVersion, publicCardOf(deps.issuer, resolved.ship.alias), 'JSONRPC');
    } catch (error) {
      return { jsonrpc: '2.0', id, error: JsonRpcTransportHandler.mapToJSONRPCError(error) };
    }
    const transport = new JsonRpcTransportHandler(requestHandlerFor(deps, resolved));
    const answered = await transport.handle(z.record(z.string(), z.unknown()).catch({}).parse(request.body), context);
    if (!(Symbol.asyncIterator in answered)) {
      return answered;
    }
    // Every stream ends in its error before any event, as no streaming method is carried.
    try {
      for await (const event of answered) {
        return event;
      }
      return await unsupported();
    } catch (error) {
      return { jsonrpc: '2.0', id, error: JsonRpcTransportHandler.mapToJSONRPCError(error) };
    }
  });


  /** One route of the HTTP+JSON binding: its answer as JSON, or its A2A error with the binding's status. */
  const restRoute = ({ method, path, answer }: { method: 'GET' | 'POST'; path: string; answer: (call: { handler: A2ARequestHandler; request: FastifyRequest; context: ServerCallContext }) => Promise<unknown> }) => {
    server.route({
      method,
      url: `${A2A_PATH}/:alias${path}`,
      handler: async (request, reply) => {
        const resolved = await resolve(request, reply);
        if (resolved === undefined) {
          return reply;
        }
        const context = contextOf(request);
        try {
          if (!isJsonBody(request)) {
            throw notSupported();
          }
          validateVersion(context.requestedVersion, publicCardOf(deps.issuer, resolved.ship.alias), 'HTTP+JSON');
          const body = await answer({ handler: requestHandlerFor(deps, resolved), request, context });
          return await reply.send(body);
        } catch (error) {
          const status = restStatusOf(error);
          return reply.code(status).send(toRestErrorBody(error, status));
        }
      },
    });
  };
  const taskIdOf = (request: FastifyRequest) => taskParamsSchema.parse(request.params).taskId;

  restRoute({ method: 'GET', path: '/extendedAgentCard', answer: async ({ handler, context }) => AgentCard.toJSON(await handler.getAuthenticatedExtendedAgentCard({ tenant: '' }, context)) });
  restRoute({
    method: 'POST',
    path: '/message::send',
    answer: async ({ handler, request, context }) => {
      const task = await handler.sendMessage(SendMessageRequest.fromJSON(request.body ?? {}), context);
      return SendMessageResponse.toJSON({ payload: 'messageId' in task ? { $case: 'message', value: task } : { $case: 'task', value: task } });
    },
  });
  restRoute({
    method: 'GET',
    path: '/tasks/:taskId',
    answer: async ({ handler, request, context }) => Task.toJSON(await handler.getTask(GetTaskRequest.fromJSON({ ...querySchema.parse(request.query), id: taskIdOf(request) }), context)),
  });
  restRoute({
    method: 'POST',
    path: '/tasks/:taskId',
    answer: async ({ handler, request, context }) => {
      const called = TASK_METHOD.exec(taskIdOf(request))?.groups;
      if (called?.method !== 'cancel' || called.taskId === undefined) {
        return unsupported();
      }
      return Task.toJSON(await handler.cancelTask({ tenant: '', id: called.taskId, metadata: undefined }, context));
    },
  });
  restRoute({
    method: 'GET',
    path: '/tasks',
    answer: async ({ handler, request, context }) => {
      const query = querySchema.parse(request.query);
      // A query parameter is text: only "true" asks for the artifacts.
      return ListTasksResponse.toJSON(await handler.listTasks(ListTasksRequest.fromJSON({ ...query, includeArtifacts: query.includeArtifacts === 'true' }), context));
    },
  });
}
