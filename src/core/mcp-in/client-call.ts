/**
 * An outside client's call (interop 3.4): the message its proxy ship sent,
 * the replies naming it, and the one rule for its state. Core keeps no state
 * of a call: submitted, working, completed and failed are the gateway's,
 * derived from what it kept and the time.
 */
import type { DeliveryId, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';

/** A reply naming the call's message, as the gateway kept it before acknowledging its delivery. */
export interface CallReply {
  deliveryId: DeliveryId;
  messageId: MessageId;
  contentType: string;
  payload: string;
  receivedAt: Date;
}

/** Where the call's delivery stands, as the fleet's sentMessage answers its sender (decision 0040). */
export type DeliveryState = 'pending' | 'received' | 'handed' | 'acknowledged' | 'handled' | 'notHandled' | 'undeliverable' | 'dismissed' | 'abandoned';

/** The delivery states in which the fleet gave the call up: it fails (interop 3.4). */
const FAILED_DELIVERY: ReadonlySet<DeliveryState> = new Set(['notHandled', 'undeliverable', 'dismissed', 'abandoned']);

/** The delivery states in which the ship took the call: it works on it. */
const TAKEN_DELIVERY: ReadonlySet<DeliveryState> = new Set(['acknowledged', 'handled']);

/** An A2A call's part of its task (decision 0060): the task it belongs to, and the client's message as A2A JSON. */
export interface CallTask {
  taskId: string;
  message: string;
}

export interface ClientCall {
  fleetId: FleetId;
  party: string;
  messageId: MessageId;
  handle: string;
  shipId: ShipId;
  /** The capability called; none when an A2A message matched none, and then its first reply answers it (decision 0060). */
  capability: string | null;
  /** The capability's stated output type, its first output mode; none when it states none. */
  outputContentType: string | null;
  sentAt: Date;
  /** When the call fails without its answer, from its capability's deadline; none never fails by time. */
  deadlineAt: Date | null;
  /** Where its delivery stands, as the gateway last read it; none while not read. */
  delivery: { state: DeliveryState; since: Date } | null;
  /** Its A2A task; none for an MCP call. */
  task: CallTask | null;
  /** In the order the gateway kept them. */
  replies: CallReply[];
}

export type CallState = { state: 'submitted' } | { state: 'working' } | { state: 'completed'; answer: { contentType: string; payload: string } } | { state: 'failed' };

/** The type a plain text answer comes in, which completes a call to a ship that stated no output type. */
const PLAIN_TEXT = 'text/plain';

/** A media type as compared: lower case, with no spaces around its parameters. */
const normalized = (contentType: string) =>
  contentType
    .split(';')
    .map((part) => part.trim().toLowerCase())
    .join(';');

const essenceOf = (contentType: string) => normalized(contentType).split(';')[0] ?? '';

/** Whether two media types are the same: their case and the spaces around their parameters do not matter. */
export function isSameMediaType(left: string, right: string): boolean {
  return normalized(left) === normalized(right);
}

/** Whether a reply's media type is of this essence, whatever its parameters. */
export function isOfEssence(contentType: string, essence: string): boolean {
  return essenceOf(contentType) === essence;
}

/** When the call failed without its answer: at its deadline, or once the fleet gave its delivery up; none while neither. */
function failedAt(call: ClientCall, now: Date): Date | undefined {
  const times = [
    ...(call.deadlineAt !== null && now.getTime() >= call.deadlineAt.getTime() ? [call.deadlineAt] : []),
    ...(call.delivery !== null && FAILED_DELIVERY.has(call.delivery.state) ? [call.delivery.since] : []),
  ];
  return times.sort((left, right) => left.getTime() - right.getTime())[0];
}

/** Whether the reply answers the call: kept before the call failed, if it did. */
function isAnswer(call: ClientCall & { failed: Date | undefined }, reply: CallReply): boolean {
  const { failed } = call;
  if (failed !== undefined && reply.receivedAt.getTime() >= failed.getTime()) {
    return false;
  }
  if (call.capability === null) {
    return true;
  }
  return call.outputContentType === null ? essenceOf(reply.contentType) === PLAIN_TEXT : isSameMediaType(reply.contentType, call.outputContentType);
}

/** The reply that answers the call, if one came before it failed. */
export function answerOf(call: ClientCall, now: Date): CallReply | undefined {
  const failed = failedAt(call, now);
  return call.replies.find((reply) => isAnswer({ ...call, failed }, reply));
}

/** The replies kept before the call failed: what moves its state; a later reply is kept, and changes nothing. */
export function repliesBeforeFailure(call: ClientCall, now: Date): CallReply[] {
  const failed = failedAt(call, now);
  return call.replies.filter((reply) => failed === undefined || reply.receivedAt.getTime() < failed.getTime());
}

/** The call's state with since when it holds, by the one rule below. */
function standing(call: ClientCall, now: Date): { state: CallState; since: Date } {
  const failed = failedAt(call, now);
  const answer = answerOf(call, now);
  if (answer) {
    return { state: { state: 'completed', answer: { contentType: answer.contentType, payload: answer.payload } }, since: answer.receivedAt };
  }
  if (failed !== undefined) {
    return { state: { state: 'failed' }, since: failed };
  }
  const [first] = call.replies;
  if (first) {
    return { state: { state: 'working' }, since: first.receivedAt };
  }
  return call.delivery !== null && TAKEN_DELIVERY.has(call.delivery.state) ? { state: { state: 'working' }, since: call.delivery.since } : { state: { state: 'submitted' }, since: call.sentAt };
}

/**
 * Completed by the first reply of the stated output type, or by the first
 * reply of any type for a call of no capability, kept before it failed;
 * failed at the deadline or once the fleet gave its delivery up, and a later
 * reply changes nothing; working once any other reply came or the ship took
 * its delivery; submitted before that.
 */
export function stateOf(call: ClientCall, now: Date): CallState {
  return standing(call, now).state;
}

/** Since when the call is in its state: its sending, its first reply, its answer, or its deadline. */
export function stateSince(call: ClientCall, now: Date): Date {
  return standing(call, now).since;
}
