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

export interface ClientCall {
  fleetId: FleetId;
  party: string;
  messageId: MessageId;
  handle: string;
  shipId: ShipId;
  capability: string;
  /** The capability's stated output type, its first output mode; none when it states none. */
  outputContentType: string | null;
  sentAt: Date;
  /** When the call fails without its answer, from its capability's deadline; none never fails by time. */
  deadlineAt: Date | null;
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

function isAnswer(call: ClientCall, reply: CallReply): boolean {
  if (call.deadlineAt !== null && reply.receivedAt.getTime() >= call.deadlineAt.getTime()) {
    return false;
  }
  return call.outputContentType === null ? essenceOf(reply.contentType) === PLAIN_TEXT : normalized(reply.contentType) === normalized(call.outputContentType);
}

/** The call's state with since when it holds, by the one rule below. */
function standing(call: ClientCall, now: Date): { state: CallState; since: Date } {
  const answer = call.replies.find((reply) => isAnswer(call, reply));
  if (answer) {
    return { state: { state: 'completed', answer: { contentType: answer.contentType, payload: answer.payload } }, since: answer.receivedAt };
  }
  if (call.deadlineAt !== null && now.getTime() >= call.deadlineAt.getTime()) {
    return { state: { state: 'failed' }, since: call.deadlineAt };
  }
  const [first] = call.replies;
  return first ? { state: { state: 'working' }, since: first.receivedAt } : { state: { state: 'submitted' }, since: call.sentAt };
}

/**
 * Completed by the first reply of the stated output type, kept before the
 * deadline; failed at the deadline without one, and a later reply changes
 * nothing; working once any other reply came; submitted before that.
 */
export function stateOf(call: ClientCall, now: Date): CallState {
  return standing(call, now).state;
}

/** Since when the call is in its state: its sending, its first reply, its answer, or its deadline. */
export function stateSince(call: ClientCall, now: Date): Date {
  return standing(call, now).since;
}
