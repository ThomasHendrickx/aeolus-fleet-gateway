/**
 * The A2A shapes of the gateway's tasks (decision 0060): an inbound A2A
 * message as the core reads it, and a task view as an A2A client reads it.
 * A ship's reply goes back as the content rule A7 sends it out: text as a
 * text part, JSON as a data part, each with its content type as its media
 * type. The answer is the task's artifact; a question is the status's
 * message; a reply of `application/a2a+json` carries its own A2A status.
 */
import { Message, Role, StreamResponse, TaskState, type Artifact, type Part, type Task, type TaskStatus } from '@a2a-js/sdk';

import type { InboundMessage, InboundPart } from '../../core/a2a-in/inbound-message.js';
import type { TaskEntry, TaskView } from '../../core/a2a-in/task-view.js';
import type { CallReply } from '../../core/mcp-in/client-call.js';

/** A JSON content type: `application/json`, or any of the `+json` suffix. */
const JSON_TYPE = /^application\/(?:[\w.-]+\+)?json$/i;

const essenceOf = (contentType: string) => contentType.split(';')[0]?.trim() ?? '';

function inboundPartOf(part: Part): InboundPart {
  const mediaType = part.mediaType === '' ? {} : { mediaType: part.mediaType };
  switch (part.content?.$case) {
    case 'text':
      return { kind: 'text', text: part.content.value, ...mediaType };
    case 'data':
      return { kind: 'data', data: part.content.value, ...mediaType };
    case 'raw':
    case 'url':
    case undefined:
      return { kind: 'other' };
  }
}

/** An inbound A2A message as the core reads it: empty ids are none. */
export function inboundMessageOf(message: Message): InboundMessage {
  return {
    messageId: message.messageId,
    ...(message.taskId === '' ? {} : { taskId: message.taskId }),
    ...(message.contextId === '' ? {} : { contextId: message.contextId }),
    parts: message.parts.map(inboundPartOf),
    asJson: JSON.stringify(Message.toJSON(message)),
  };
}

/** The part a reply goes back as: JSON as data, anything else as text, with its content type. */
function partOf(reply: CallReply): Part {
  const base = { metadata: undefined, filename: '', mediaType: reply.contentType };
  if (JSON_TYPE.test(essenceOf(reply.contentType))) {
    try {
      const data: unknown = JSON.parse(reply.payload);
      return { ...base, content: { $case: 'data', value: data } };
    } catch {
      // Not JSON after all: it goes back as the text it is.
    }
  }
  return { ...base, content: { $case: 'text', value: reply.payload } };
}

function agentMessageOf(reply: CallReply, task: { taskId: string; contextId: string }): Message {
  return { messageId: reply.messageId, contextId: task.contextId, taskId: task.taskId, role: Role.ROLE_AGENT, parts: [partOf(reply)], metadata: undefined, extensions: [], referenceTaskIds: [] };
}

/** A client's message as kept, in the task and its context. */
function clientMessageOf(json: string, task: { taskId: string; contextId: string }): Message {
  return { ...Message.fromJSON(JSON.parse(json)), taskId: task.taskId, contextId: task.contextId };
}

/** The A2A status a reply of `application/a2a+json` carries: a task's or a status update's; working when it carries none. */
function carriedStatusOf(reply: CallReply): TaskStatus | undefined {
  try {
    const carried = StreamResponse.fromJSON(JSON.parse(reply.payload)).payload;
    switch (carried?.$case) {
      case 'task':
        return carried.value.status;
      case 'statusUpdate':
        return carried.value.status;
      case 'artifactUpdate':
      case 'message':
      case undefined:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

function statusOf(view: TaskView): { status: TaskStatus; artifacts: Artifact[] } {
  const timestamp = view.status.since.toISOString();
  const plain = (state: TaskState, message?: Message) => ({ status: { state, message, timestamp }, artifacts: [] });
  const ids = { taskId: view.taskId, contextId: view.contextId };
  switch (view.status.state) {
    case 'submitted':
      return plain(TaskState.TASK_STATE_SUBMITTED);
    case 'working':
      return plain(TaskState.TASK_STATE_WORKING);
    case 'inputRequired':
      return plain(TaskState.TASK_STATE_INPUT_REQUIRED, agentMessageOf(view.status.question, ids));
    case 'completed': {
      const { answer } = view.status;
      return { status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp }, artifacts: [{ artifactId: answer.messageId, name: '', description: '', parts: [partOf(answer)], metadata: undefined, extensions: [] }] };
    }
    case 'failed':
      return plain(TaskState.TASK_STATE_FAILED);
    case 'carried': {
      const carried = carriedStatusOf(view.status.reply);
      return carried === undefined ? plain(TaskState.TASK_STATE_WORKING) : { status: { ...carried, timestamp: carried.timestamp ?? timestamp }, artifacts: [] };
    }
  }
}

function historyEntryOf(entry: TaskEntry, ids: { taskId: string; contextId: string }): Message {
  return entry.by === 'client' ? clientMessageOf(entry.message, ids) : agentMessageOf(entry.reply, ids);
}

/** The task as A2A reads it, with the latest entries of its history when the client asked for a length, and its artifacts unless left out. */
export function taskOf(view: TaskView, options: { historyLength?: number; isWithoutArtifacts?: boolean } = {}): Task {
  const ids = { taskId: view.taskId, contextId: view.contextId };
  const { status, artifacts } = statusOf(view);
  const history = view.history.map((entry) => historyEntryOf(entry, ids));
  const { historyLength } = options;
  return {
    id: view.taskId,
    contextId: view.contextId,
    status,
    artifacts: options.isWithoutArtifacts === true ? [] : artifacts,
    history: historyLength === undefined ? history : history.slice(history.length - Math.min(historyLength, history.length)),
    metadata: undefined,
  };
}
