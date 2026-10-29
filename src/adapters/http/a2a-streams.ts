/**
 * A2A streams (slice 3): a followed task as A2A's stream events, and the
 * events as server-sent events on a Fastify reply; a task's events as its
 * webhook gets them (slice 4). A stream begins with the
 * task, then a status update for each change, each new artifact first, and
 * closes at a terminal state, the state an `application/a2a+json` reply
 * carries included. An error before the first event answers as the call's
 * plain error; after it, as an `error` event that ends the stream.
 */
import { StreamResponse, TaskState, type Task } from '@a2a-js/sdk';
import type { FastifyReply } from 'fastify';

import type { PushEvents } from '../../core/a2a-in/ports.js';
import type { TaskView } from '../../core/a2a-in/task-view.js';
import { taskOf } from './a2a-tasks.js';

const TERMINAL_STATES = new Set([TaskState.TASK_STATE_COMPLETED, TaskState.TASK_STATE_FAILED, TaskState.TASK_STATE_CANCELED, TaskState.TASK_STATE_REJECTED]);

/** Whether A2A reads the task as ended. */
export const isEnded = (task: Task): boolean => task.status !== undefined && TERMINAL_STATES.has(task.status.state);

/** The stream of a followed task: the task first, then its changes, until it ends. */
export async function* streamOf(views: AsyncIterable<TaskView>): AsyncGenerator<StreamResponse, void, undefined> {
  let last: Task | undefined;
  for await (const view of views) {
    const task = taskOf(view);
    if (last === undefined) {
      yield { payload: { $case: 'task', value: task } };
    } else {
      const seen = new Set(last.artifacts.map((artifact) => artifact.artifactId));
      for (const artifact of task.artifacts.filter((each) => !seen.has(each.artifactId))) {
        yield { payload: { $case: 'artifactUpdate', value: { taskId: task.id, contextId: task.contextId, artifact, append: false, lastChunk: true, metadata: undefined } } };
      }
      yield { payload: { $case: 'statusUpdate', value: { taskId: task.id, contextId: task.contextId, status: task.status, metadata: undefined } } };
    }
    last = task;
    if (isEnded(task)) {
      return;
    }
  }
}

/** The events a webhook gets for a task as it stands (slice 4): each of its artifacts, then its status, as a stream sends them. */
export const a2aPushEvents: PushEvents = {
  eventsOf: (view) => {
    const task = taskOf(view);
    const ids = { taskId: task.id, contextId: task.contextId, metadata: undefined };
    const events: StreamResponse[] = [
      ...task.artifacts.map((artifact): StreamResponse => ({ payload: { $case: 'artifactUpdate', value: { ...ids, artifact, append: false, lastChunk: true } } })),
      { payload: { $case: 'statusUpdate', value: { ...ids, status: task.status } } },
    ];
    return events.map((event) => JSON.stringify(StreamResponse.toJSON(event)));
  },
};

const SSE_HEADERS = { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' };

const eventOf = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

/**
 * Answers the events as server-sent events, once the first came: an error
 * before it is the caller's to answer, as it rejects. An error after it is
 * the last event, as `errorOf` writes it.
 */
export async function sendEvents(reply: FastifyReply, stream: { events: AsyncIterator<unknown>; errorOf: (error: unknown) => unknown }): Promise<void> {
  const first = await stream.events.next();
  reply.hijack();
  reply.raw.writeHead(200, SSE_HEADERS);
  try {
    if (first.done !== true) {
      reply.raw.write(eventOf(first.value));
      for (let next = await stream.events.next(); next.done !== true; next = await stream.events.next()) {
        reply.raw.write(eventOf(next.value));
      }
    }
  } catch (error) {
    reply.raw.write(`event: error\n${eventOf(stream.errorOf(error))}`);
  } finally {
    reply.raw.end();
  }
}
