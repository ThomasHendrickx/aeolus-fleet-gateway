/**
 * The outside A2A agents the gateway calls (slice 6), through @a2a-js/sdk's
 * client over JSON-RPC or HTTP+JSON (A11), one client per call with the
 * credential from the vault: none, a bearer, or a token the issuer gives
 * for client credentials. A failure reads as where it happened, so the core
 * decides whether it may hand the message again: an A2A error or an HTTP
 * 4xx is the agent's refusal; a 5xx, a timeout or a connection broken mid
 * answer is no answer, and it may have run; a credential the issuer would
 * not give, or an agent no connection reached, sent nothing. Each task,
 * status, artifact and message reads as the A2A JSON it came as.
 */
import { AgentCard, GetTaskRequest, Message, SendMessageRequest, StreamResponse, SubscribeToTaskRequest, TaskState, type Part, type TaskArtifactUpdateEvent, type Task, type TaskStatus } from '@a2a-js/sdk';
import { Client, JsonRpcTransportFactory, RestTransportFactory } from '@a2a-js/sdk/client';
import { A2AError, TaskNotFoundError } from '@a2a-js/sdk/errors';
import { z } from 'zod';

import type { AgentEvent, AgentState } from '../../core/a2a-out/agent-event.js';
import type { AgentPart, OutboundMessage } from '../../core/a2a-out/agent-message.js';
import type { A2aAgents, AgentConnection, GatewayStatuses, SendOutcome, SubscriptionEnd, TaskRead } from '../../core/a2a-out/ports.js';
import type { McpServerCredential } from '../../core/vault/credential.js';

/** The A2A version the gateway speaks to an agent. */
const A2A_VERSION = '1.0';

const HTTP_SERVER_ERROR = 500;
const HTTP_CLIENT_ERROR = 400;

/** A token kept until this long before it expires. */
const TOKEN_MARGIN_MS = 30_000;
const MS_PER_SECOND = 1_000;

/** The gateway reached no agent: its credential could not be had, or no connection was made. Nothing ran. */
class NotSentError extends Error {}

/** The agent answered a 5xx: it may have run. */
class NoAnswerError extends Error {}

const STATES: Record<TaskState, AgentState> = {
  [TaskState.TASK_STATE_UNSPECIFIED]: 'unspecified',
  [TaskState.TASK_STATE_SUBMITTED]: 'submitted',
  [TaskState.TASK_STATE_WORKING]: 'working',
  [TaskState.TASK_STATE_COMPLETED]: 'completed',
  [TaskState.TASK_STATE_FAILED]: 'failed',
  [TaskState.TASK_STATE_CANCELED]: 'canceled',
  [TaskState.TASK_STATE_INPUT_REQUIRED]: 'inputRequired',
  [TaskState.TASK_STATE_REJECTED]: 'rejected',
  [TaskState.TASK_STATE_AUTH_REQUIRED]: 'authRequired',
  [TaskState.UNRECOGNIZED]: 'unspecified',
};

function partsOf(parts: readonly Part[]): AgentPart[] {
  return parts.map((part): AgentPart => {
    switch (part.content?.$case) {
      case 'text':
        return { kind: 'text', text: part.content.value, mediaType: part.mediaType === '' ? 'text/plain' : part.mediaType };
      case 'data':
        return { kind: 'data', data: part.content.value, mediaType: part.mediaType === '' ? 'application/json' : part.mediaType };
      case 'raw':
      case 'url':
      case undefined:
        return { kind: 'other' };
    }
  });
}

const jsonOf = (event: StreamResponse) => JSON.stringify(StreamResponse.toJSON(event));

function statusEvent(update: { taskId: string; contextId: string; status: TaskStatus | undefined }): AgentEvent {
  return { kind: 'status', state: STATES[update.status?.state ?? TaskState.TASK_STATE_UNSPECIFIED], timestamp: update.status?.timestamp ?? null, json: jsonOf({ payload: { $case: 'statusUpdate', value: { ...update, metadata: undefined } } }) };
}

function artifactEvent(update: TaskArtifactUpdateEvent): AgentEvent {
  return { kind: 'artifact', artifactId: update.artifact?.artifactId ?? '', isAppended: update.append, parts: partsOf(update.artifact?.parts ?? []), json: jsonOf({ payload: { $case: 'artifactUpdate', value: update } }) };
}

const messageEvent = (message: Message): AgentEvent => ({ kind: 'message', messageId: message.messageId, parts: partsOf(message.parts), json: jsonOf({ payload: { $case: 'message', value: message } }) });

/** A task as it stands: each artifact, then its status. */
function eventsOfTask(task: Task): AgentEvent[] {
  return [...task.artifacts.map((artifact) => artifactEvent({ taskId: task.id, contextId: task.contextId, artifact, append: false, lastChunk: true, metadata: undefined })), statusEvent({ taskId: task.id, contextId: task.contextId, status: task.status })];
}

function eventsOfStream(response: StreamResponse): AgentEvent[] {
  switch (response.payload?.$case) {
    case 'task':
      return eventsOfTask(response.payload.value);
    case 'message':
      return [messageEvent(response.payload.value)];
    case 'statusUpdate':
      return [statusEvent(response.payload.value)];
    case 'artifactUpdate':
      return [artifactEvent(response.payload.value)];
    case undefined:
      return [];
  }
}

function partJsonOf(part: AgentPart): Record<string, unknown> {
  switch (part.kind) {
    case 'text':
      return { text: part.text, mediaType: part.mediaType };
    case 'data':
      return { data: part.data, mediaType: part.mediaType };
    case 'other':
      return {};
  }
}

/** The SDK's Message for the gateway's: its parts, or the sender's own A2A Message with the gateway's ids put in. */
function sdkMessageOf(message: OutboundMessage): Message {
  const ids = { messageId: message.messageId, ...(message.taskId === null ? {} : { taskId: message.taskId }), ...(message.contextId === null ? {} : { contextId: message.contextId }) };
  return message.content.kind === 'whole'
    ? Message.fromJSON({ role: 'ROLE_USER', ...message.content.message, ...ids })
    : Message.fromJSON({ ...ids, role: 'ROLE_USER', parts: message.content.parts.map(partJsonOf) });
}

const systemError = z.object({ code: z.string() });

/** No connection was made, so nothing was sent. */
function isConnectionRefused(error: unknown): boolean {
  const cause = error instanceof Error ? error.cause : undefined;
  const failure = systemError.safeParse(cause);
  return failure.success && ['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH'].includes(failure.data.code);
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const metadataSchema = z.object({ token_endpoint: z.url() });
const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().optional() });

/** A token the issuer gives for client credentials, kept until it nearly expires. */
function createTokens() {
  const kept = new Map<string, { token: string; until: number }>();
  return async (credential: Extract<McpServerCredential, { kind: 'clientCredentials' }>, signal: AbortSignal): Promise<string> => {
    const key = JSON.stringify([credential.issuer, credential.clientId, credential.scope ?? '']);
    const held = kept.get(key);
    if (held !== undefined && held.until > Date.now()) {
      return held.token;
    }
    try {
      const metadata = metadataSchema.parse(await (await fetch(`${credential.issuer.replace(/\/$/, '')}/.well-known/oauth-authorization-server`, { signal })).json());
      const answer = await fetch(metadata.token_endpoint, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${credential.clientId}:${credential.clientSecret}`).toString('base64')}` },
        body: new URLSearchParams({ grant_type: 'client_credentials', ...(credential.scope === undefined ? {} : { scope: credential.scope }) }),
      });
      if (!answer.ok) {
        throw new Error(`the issuer answered ${String(answer.status)}`);
      }
      const given = tokenSchema.parse(await answer.json());
      kept.set(key, { token: given.access_token, until: Date.now() + (given.expires_in ?? 0) * MS_PER_SECOND - TOKEN_MARGIN_MS });
      return given.access_token;
    } catch (error) {
      throw new NotSentError(`The issuer gave no token for the client credentials: ${reasonOf(error)}`);
    }
  };
}

export function createA2aAgents(deps: { timeoutMs: number }): A2aAgents {
  const tokenOf = createTokens();

  /** A client for one call, its every request signed in and timed out, and what the agent's HTTP answer was. */
  const clientFor = async (connection: AgentConnection, signal: AbortSignal) => {
    const observed: { status: number | undefined } = { status: undefined };
    const { credential } = connection;
    const authorization = credential.kind === 'none' ? undefined : credential.kind === 'bearer' ? `Bearer ${credential.token}` : `Bearer ${await tokenOf(credential, signal)}`;
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      if (authorization !== undefined) {
        headers.set('authorization', authorization);
      }
      let response: Response;
      try {
        response = await fetch(input, { ...init, headers, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal });
      } catch (error) {
        throw isConnectionRefused(error) ? new NotSentError(reasonOf(error)) : error;
      }
      observed.status = response.status;
      if (response.status >= HTTP_SERVER_ERROR) {
        await response.body?.cancel();
        throw new NoAnswerError(`The agent answered ${String(response.status)}`);
      }
      return response;
    };
    const card = AgentCard.fromJSON({ name: 'outside agent', supportedInterfaces: [{ url: connection.endpoint.url, protocolBinding: connection.endpoint.protocolBinding, protocolVersion: A2A_VERSION }] });
    const factory = connection.endpoint.protocolBinding === 'HTTP+JSON' ? new RestTransportFactory({ fetchImpl }) : new JsonRpcTransportFactory({ fetchImpl });
    return { client: new Client(await factory.create(connection.endpoint.url, card), card), observed };
  };

  /** Where a failure happened: refused by the agent, never sent, or unanswered; a task the agent knows no more is gone. */
  const failureOf = (error: unknown, observed: { status: number | undefined }) => {
    if (error instanceof NotSentError) {
      return { kind: 'notSent', reason: error.message } as const;
    }
    if (error instanceof NoAnswerError) {
      return { kind: 'unanswered', reason: error.message } as const;
    }
    if (error instanceof TaskNotFoundError) {
      return { kind: 'gone', reason: reasonOf(error) } as const;
    }
    if (error instanceof A2AError || (observed.status !== undefined && observed.status >= HTTP_CLIENT_ERROR)) {
      return { kind: 'refused', reason: observed.status !== undefined && observed.status >= HTTP_CLIENT_ERROR ? `The agent answered ${String(observed.status)}: ${reasonOf(error)}` : reasonOf(error) } as const;
    }
    return { kind: 'unanswered', reason: reasonOf(error) } as const;
  };

  return {
    send: async (connection, message): Promise<SendOutcome> => {
      const signal = AbortSignal.timeout(deps.timeoutMs);
      let observed: { status: number | undefined } = { status: undefined };
      try {
        const made = await clientFor(connection, signal);
        observed = made.observed;
        const answer = await made.client.sendMessage(SendMessageRequest.fromJSON({ message: Message.toJSON(sdkMessageOf(message)), configuration: { returnImmediately: true } }), { signal });
        return 'messageId' in answer ? { kind: 'message', event: messageEvent(answer) } : { kind: 'task', taskId: answer.id, contextId: answer.contextId, events: eventsOfTask(answer) };
      } catch (error) {
        const failure = failureOf(error, observed);
        return failure.kind === 'gone' ? { kind: 'refused', reason: failure.reason } : failure;
      }
    },
    getTask: async (connection, taskId): Promise<TaskRead> => {
      const signal = AbortSignal.timeout(deps.timeoutMs);
      let observed: { status: number | undefined } = { status: undefined };
      try {
        const made = await clientFor(connection, signal);
        observed = made.observed;
        return { kind: 'read', events: eventsOfTask(await made.client.getTask(GetTaskRequest.fromJSON({ id: taskId }), { signal })) };
      } catch (error) {
        const failure = failureOf(error, observed);
        return failure.kind === 'gone' ? failure : { kind: 'unanswered', reason: failure.reason };
      }
    },
    subscribe: async (connection, { taskId, timeoutMs, signal, onEvent }): Promise<SubscriptionEnd> => {
      const until = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
      let observed: { status: number | undefined } = { status: undefined };
      try {
        const made = await clientFor(connection, until);
        observed = made.observed;
        for await (const response of made.client.resubscribeTask(SubscribeToTaskRequest.fromJSON({ id: taskId }), { signal: until })) {
          for (const event of eventsOfStream(response)) {
            await onEvent(event);
          }
        }
        return { kind: 'closed' };
      } catch (error) {
        const failure = failureOf(error, observed);
        return failure.kind === 'gone' ? failure : { kind: 'broken', reason: failure.reason };
      }
    },
  };
}

/** The gateway's own statuses, as the A2A JSON the sender reads: the state, with the reason as the agent's message. */
export const gatewayStatuses: GatewayStatuses = {
  statusOf: ({ taskId, contextId, state, reason, messageId }) => {
    const message = Message.fromJSON({ messageId, taskId, contextId, role: 'ROLE_AGENT', parts: [{ text: reason }] });
    return statusEvent({ taskId, contextId, status: { state: state === 'failed' ? TaskState.TASK_STATE_FAILED : TaskState.TASK_STATE_REJECTED, message, timestamp: undefined } });
  },
};
