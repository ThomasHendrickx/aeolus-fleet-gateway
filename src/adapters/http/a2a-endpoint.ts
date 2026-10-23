/**
 * The gateway's A2A endpoints for outside A2A clients (decision 0060), as
 * Fastify routes beside /mcp. Each alias has its public card, served to
 * anyone in the same shape, and its interface, where a client calls with
 * the bearer it was shown. The bearer names the party; the alias names a
 * ship the party's proxy ship reaches now, or the call is not found, the
 * same for an alias of no ship. While the fleet's outside parties are off,
 * every call with a bearer is refused. The SDK reads the call over
 * JSON-RPC and HTTP+JSON; the gateway answers GetExtendedAgentCard,
 * SendMessage, SendStreamingMessage, GetTask, SubscribeToTask, ListTasks,
 * CancelTask and the push config methods.
 */
import { AgentCard, GetTaskRequest, ListTaskPushNotificationConfigsResponse, ListTasksRequest, ListTasksResponse, SendMessageRequest, SendMessageResponse, StreamResponse, Task, TaskPushNotificationConfig } from '@a2a-js/sdk';
import { ContentTypeNotSupportedError, RequestMalformedError, TaskNotCancelableError, TaskNotFoundError, UnsupportedOperationError, restStatusFor, toRestErrorBody } from '@a2a-js/sdk/errors';
import { JsonRpcTransportHandler, ServerCallContext, validateVersion, type A2ARequestHandler } from '@a2a-js/sdk/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { A2aCaller, AuthenticateA2aClient } from '../../core/a2a-in/authenticate-a2a-client.js';
import { isOfEssence } from '../../core/mcp-in/client-call.js';
import type { FindReachedShip, FindReachedShipRefusal } from '../../core/a2a-in/find-reached-ship.js';
import type { FollowA2aTask } from '../../core/a2a-in/follow-a2a-task.js';
import type { ListPushConfigs } from '../../core/a2a-in/list-push-configs.js';
import type { PushConfigView } from '../../core/a2a-in/push-config-view.js';
import type { ReadPushConfig } from '../../core/a2a-in/read-push-config.js';
import type { RemovePushConfig } from '../../core/a2a-in/remove-push-config.js';
import type { SetPushConfig } from '../../core/a2a-in/set-push-config.js';
import type { ListA2aTasks } from '../../core/a2a-in/list-a2a-tasks.js';
import type { ReachedShip } from '../../core/a2a-in/list-reached-ships.js';
import type { ReadA2aTask } from '../../core/a2a-in/read-a2a-task.js';
import type { SendA2aMessage, SendA2aMessageRefusal } from '../../core/a2a-in/send-a2a-message.js';
import type { SubscribeToA2aTask } from '../../core/a2a-in/subscribe-to-a2a-task.js';
import { A2A_PATH, ALIAS_PATTERN, extendedCardOf, publicCardOf } from './a2a-cards.js';
import { isEnded, sendEvents, streamOf } from './a2a-streams.js';
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
  followTask: FollowA2aTask;
  subscribeToTask: SubscribeToA2aTask;
  setPushConfig: SetPushConfig;
  readPushConfig: ReadPushConfig;
  listPushConfigs: ListPushConfigs;
  removePushConfig: RemovePushConfig;
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

/** A push config as A2A answers it: its token and authentication stay in the vault. */
const pushConfigOf = (config: PushConfigView): TaskPushNotificationConfig => ({ tenant: '', ...config, token: '', authentication: undefined });

/** The A2A error of a refused push config call: an unknown task or config is not found, a webhook refused is a malformed request. */
function pushErrorOf(refusal: { kind: 'TASK_NOT_FOUND' | 'PUSH_CONFIG_NOT_FOUND' | 'WEBHOOK_REFUSED'; message: string }): Error {
  return refusal.kind === 'WEBHOOK_REFUSED' ? new RequestMalformedError(refusal.message) : new TaskNotFoundError(refusal.message);
}

/** The A2A methods for one caller's call to one reached ship: its extended card, and its tasks. */
function requestHandlerFor(deps: A2aEndpointDeps, { caller, ship, signal }: { caller: A2aCaller; ship: ReachedShip; signal: AbortSignal }): A2ARequestHandler {
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
    // The message is sent as a SendMessage that returns at once, and its task is followed from there.
    sendMessageStream: async function* ({ message }) {
      if (message === undefined) {
        throw new RequestMalformedError('Send a message');
      }
      const sent = await deps.sendMessage({ caller, alias: ship.alias, message: inboundMessageOf(message), isBlocking: false });
      if (!sent.isOk) {
        throw errorOf(sent.error);
      }
      yield* streamOf(deps.followTask({ caller, taskId: sent.value.taskId, signal }));
    },
    getTask: async ({ id, historyLength }) => taskOf(await read(id), historyLength === undefined ? {} : { historyLength }),
    // A8: a ship's work is not the gateway's to stop.
    cancelTask: async ({ id }) => {
      await read(id);
      throw new TaskNotCancelableError(`The task ${id} cannot be canceled`);
    },
    createTaskPushNotificationConfig: async ({ taskId, id, url, token, authentication }) => {
      const set = await deps.setPushConfig({ caller, config: { taskId, ...(id === '' ? {} : { id }), url, token: token === '' ? null : token, authentication: authentication ?? null } });
      if (!set.isOk) {
        throw pushErrorOf(set.error);
      }
      return pushConfigOf(set.value);
    },
    getTaskPushNotificationConfig: async ({ taskId, id }) => {
      const read = await deps.readPushConfig({ caller, taskId, id });
      if (!read.isOk) {
        throw pushErrorOf(read.error);
      }
      return pushConfigOf(read.value);
    },
    listTaskPushNotificationConfigs: async ({ taskId, pageSize, pageToken }) => {
      const listed = await deps.listPushConfigs({ caller, taskId, pageSize, pageToken });
      if (!listed.isOk) {
        throw pushErrorOf(listed.error);
      }
      return { configs: listed.value.configs.map(pushConfigOf), nextPageToken: listed.value.next ?? '' };
    },
    deleteTaskPushNotificationConfig: async ({ taskId, id }) => {
      const removed = await deps.removePushConfig({ caller, taskId, id });
      if (!removed.isOk) {
        throw pushErrorOf(removed.error);
      }
    },
    resubscribe: async function* ({ id }) {
      const subscribed = await deps.subscribeToTask({ caller, taskId: id, signal });
      if (!subscribed.isOk) {
        throw subscribed.error.kind === 'TASK_NOT_FOUND' ? new TaskNotFoundError(subscribed.error.message) : new UnsupportedOperationError(subscribed.error.message);
      }
      const events = streamOf(subscribed.value);
      const first = await events.next();
      // A state an A2A reply carries can end the task where the gateway's own states do not.
      if (first.done === true || (first.value.payload?.$case === 'task' && isEnded(first.value.payload.value))) {
        throw new UnsupportedOperationError(`The task ${id} has ended: read it with GetTask`);
      }
      yield first.value;
      yield* events;
    },
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

/** A stream answered as server-sent events, its events as the HTTP+JSON binding writes them. */
class EventStream {
  constructor(readonly events: AsyncIterator<unknown>) {}
}

/** The HTTP+JSON stream of A2A events, each written as its JSON. */
async function* jsonEventsOf(events: AsyncIterable<StreamResponse>): AsyncGenerator<unknown, void, undefined> {
  for await (const event of events) {
    yield StreamResponse.toJSON(event);
  }
}

const eventStreamOf = (events: AsyncIterable<StreamResponse>) => new EventStream(jsonEventsOf(events));

/** A signal aborted once the reply ends, its client drops it, or the gateway stops, so a stream stops following its task. */
function signalOf(reply: FastifyReply, stopping: AbortSignal): AbortSignal {
  const controller = new AbortController();
  reply.raw.once('close', () => {
    controller.abort();
  });
  return AbortSignal.any([controller.signal, stopping]);
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

  // A stream stays open until its task ends: a stopping gateway closes it, or the server would wait for it.
  const stopping = new AbortController();
  server.addHook('preClose', () => {
    stopping.abort();
    return Promise.resolve();
  });

  void server.register((calls) => {
    registerCalls(calls, { deps, resolve, stopping: stopping.signal });
    return Promise.resolve();
  });
}

/** Whether the call's body is JSON, as both bindings take it: no body counts, as a POST with no body (CancelTask) may say JSON or nothing. */
function isJsonBody(request: FastifyRequest): boolean {
  const contentType = request.headers['content-type'];
  // An empty body is no body, whatever content type it names (a DELETE).
  return contentType === undefined || request.body === undefined || request.body === '' || REST_MEDIA_TYPES.some((mediaType) => isOfEssence(contentType, mediaType));
}

/**
 * The calls of both bindings, in a scope of their own: there a JSON body may
 * be empty (CancelTask), and a body of any other content type is kept as
 * text, so the call answers ContentTypeNotSupportedError and sends nothing.
 */
function registerCalls(server: FastifyInstance, { deps, resolve, stopping }: { deps: A2aEndpointDeps; resolve: (request: FastifyRequest, reply: FastifyReply) => Promise<{ caller: A2aCaller; ship: ReachedShip } | undefined>; stopping: AbortSignal }): void {
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
    const transport = new JsonRpcTransportHandler(requestHandlerFor(deps, { ...resolved, signal: signalOf(reply, stopping) }));
    const answered = await transport.handle(z.record(z.string(), z.unknown()).catch({}).parse(request.body), context);
    if (!(Symbol.asyncIterator in answered)) {
      return answered;
    }
    const errorOf = (error: unknown) => ({ jsonrpc: '2.0', id, error: JsonRpcTransportHandler.mapToJSONRPCError(error) });
    // An error before the first event answers as the call's plain error.
    const refused = await sendEvents(reply, { events: answered[Symbol.asyncIterator](), errorOf }).then(
      () => undefined,
      (error: unknown) => errorOf(error),
    );
    return refused ?? reply;
  });


  /** One route of the HTTP+JSON binding: its answer as JSON, or its A2A error with the binding's status. */
  const restRoute = ({ method, path, answer }: { method: 'GET' | 'POST' | 'DELETE'; path: string; answer: (call: { handler: A2ARequestHandler; request: FastifyRequest; context: ServerCallContext }) => Promise<unknown> }) => {
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
          const body = await answer({ handler: requestHandlerFor(deps, { ...resolved, signal: signalOf(reply, stopping) }), request, context });
          if (body instanceof EventStream) {
            // An error before the first event rejects, and is answered below.
            await sendEvents(reply, { events: body.events, errorOf: (error) => toRestErrorBody(error, restStatusOf(error)) });
            return undefined;
          }
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
    method: 'POST',
    path: '/message::stream',
    answer: ({ handler, request, context }) => Promise.resolve(eventStreamOf(handler.sendMessageStream(SendMessageRequest.fromJSON(request.body ?? {}), context))),
  });
  /** SubscribeToTask's stream: on GET and on POST, as the specification has not settled its verb. */
  const subscribed = ({ handler, context }: { handler: A2ARequestHandler; context: ServerCallContext }, taskId: string) => eventStreamOf(handler.resubscribe({ tenant: '', id: taskId }, context));
  restRoute({
    method: 'GET',
    path: '/tasks/:taskId',
    answer: async (call) => {
      const called = TASK_METHOD.exec(taskIdOf(call.request))?.groups;
      if (called?.method === 'subscribe' && called.taskId !== undefined) {
        return subscribed(call, called.taskId);
      }
      return Task.toJSON(await call.handler.getTask(GetTaskRequest.fromJSON({ ...querySchema.parse(call.request.query), id: taskIdOf(call.request) }), call.context));
    },
  });
  restRoute({
    method: 'POST',
    path: '/tasks/:taskId',
    answer: async (call) => {
      const called = TASK_METHOD.exec(taskIdOf(call.request))?.groups;
      if (called?.taskId === undefined) {
        return unsupported();
      }
      if (called.method === 'cancel') {
        return Task.toJSON(await call.handler.cancelTask({ tenant: '', id: called.taskId, metadata: undefined }, call.context));
      }
      return called.method === 'subscribe' ? subscribed(call, called.taskId) : unsupported();
    },
  });
  const pushParamsSchema = z.object({ taskId: z.string(), configId: z.string().optional() });
  restRoute({
    method: 'POST',
    path: '/tasks/:taskId/pushNotificationConfigs',
    answer: async ({ handler, request, context }) => {
      const { taskId } = pushParamsSchema.parse(request.params);
      return TaskPushNotificationConfig.toJSON(await handler.createTaskPushNotificationConfig(TaskPushNotificationConfig.fromJSON({ ...z.record(z.string(), z.unknown()).catch({}).parse(request.body), taskId }), context));
    },
  });
  restRoute({
    method: 'GET',
    path: '/tasks/:taskId/pushNotificationConfigs',
    answer: async ({ handler, request, context }) => {
      const { taskId } = pushParamsSchema.parse(request.params);
      const query = z.object({ pageSize: z.coerce.number().int().optional(), pageToken: z.string().optional() }).catch({}).parse(request.query);
      return ListTaskPushNotificationConfigsResponse.toJSON(await handler.listTaskPushNotificationConfigs({ tenant: '', taskId, pageSize: query.pageSize ?? 0, pageToken: query.pageToken ?? '' }, context));
    },
  });
  restRoute({
    method: 'GET',
    path: '/tasks/:taskId/pushNotificationConfigs/:configId',
    answer: async ({ handler, request, context }) => {
      const { taskId, configId = '' } = pushParamsSchema.parse(request.params);
      return TaskPushNotificationConfig.toJSON(await handler.getTaskPushNotificationConfig({ tenant: '', taskId, id: configId }, context));
    },
  });
  restRoute({
    method: 'DELETE',
    path: '/tasks/:taskId/pushNotificationConfigs/:configId',
    answer: async ({ handler, request, context }) => {
      const { taskId, configId = '' } = pushParamsSchema.parse(request.params);
      await handler.deleteTaskPushNotificationConfig({ tenant: '', taskId, id: configId }, context);
      return {};
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
