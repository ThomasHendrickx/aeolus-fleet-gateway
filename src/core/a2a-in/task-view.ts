/**
 * An A2A task as its client reads it (interop 3.4, decision 0060): the
 * calls its client made in it, in the order sent, read by the one rule of
 * the call store. Its state is its latest call's: completed by the answer,
 * input required by a question, the state an `application/a2a+json` reply
 * carries, failed at the deadline or when the fleet gave the delivery up,
 * working once the ship took it, submitted before. Its history is the
 * client's messages and the ship's replies in the order they came.
 */
import { A2A_CONTENT_TYPE, QUESTION_CONTENT_TYPE, answerOf, isOfEssence, repliesBeforeFailure, stateOf, stateSince, type CallReply, type ClientCall } from '../mcp-in/client-call.js';
import type { StoredTask } from '../mcp-in/ports.js';

export type TaskStatus =
  | { state: 'submitted' }
  | { state: 'working' }
  | { state: 'inputRequired'; question: CallReply }
  | { state: 'completed'; answer: CallReply }
  | { state: 'failed' }
  /** The state an A2A reply carries, for the adapter that speaks A2A to read. */
  | { state: 'carried'; reply: CallReply };

export type TaskEntry = { by: 'client'; message: string; at: Date } | { by: 'ship'; reply: CallReply };

export interface TaskView {
  taskId: string;
  contextId: string;
  status: TaskStatus & { since: Date };
  history: TaskEntry[];
}

const isA2a = (reply: CallReply) => isOfEssence(reply.contentType, A2A_CONTENT_TYPE);
const isQuestion = (reply: CallReply) => isOfEssence(reply.contentType, QUESTION_CONTENT_TYPE);

/**
 * The status of one call. Failed wins once the call failed; else its answer
 * completes it; else the latest A2A reply or question drives it; else it is
 * working or submitted, as the call's own state says.
 */
function statusOf(call: ClientCall, now: Date): TaskStatus & { since: Date } {
  const own = stateOf(call, now);
  const since = stateSince(call, now);
  if (own.state === 'failed') {
    return { state: 'failed', since };
  }
  const answer = answerOf(call, now);
  if (answer !== undefined && !isA2a(answer)) {
    return { state: 'completed', answer, since: answer.receivedAt };
  }
  const latest = repliesBeforeFailure(call, now)
    .filter((reply) => isA2a(reply) || isQuestion(reply))
    .at(-1);
  if (latest !== undefined) {
    return isA2a(latest) ? { state: 'carried', reply: latest, since: latest.receivedAt } : { state: 'inputRequired', question: latest, since: latest.receivedAt };
  }
  return own.state === 'submitted' ? { state: 'submitted', since } : { state: 'working', since };
}

/** Whether the task ended: completed or failed, so it takes no follow-up and a follow of it ends. */
export const isTerminal = (view: TaskView): boolean => view.status.state === 'completed' || view.status.state === 'failed';

/** What tells one view of a task from the next: its state, since when, and how much history it holds. */
export const markOf = (view: TaskView): string => `${view.status.state}:${String(view.status.since.getTime())}:${String(view.history.length)}`;

/** The task as its client reads it now; a task with no call kept yet is submitted since now. */
export function taskViewOf(task: StoredTask, now: Date): TaskView {
  const latest = task.calls.at(-1);
  const history = task.calls
    .flatMap((call): (TaskEntry & { at: Date })[] => [{ by: 'client', message: call.task?.message ?? '', at: call.sentAt }, ...call.replies.map((reply) => ({ by: 'ship' as const, reply, at: reply.receivedAt }))])
    .sort((left, right) => left.at.getTime() - right.at.getTime())
    .map((entry): TaskEntry => (entry.by === 'client' ? entry : { by: 'ship', reply: entry.reply }));
  return { taskId: task.taskId, contextId: task.contextId, status: latest === undefined ? { state: 'submitted', since: now } : statusOf(latest, now), history };
}
