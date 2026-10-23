/**
 * Use case: an outside A2A client sends a message (decision 0060). The
 * message is one its party's proxy ship sends to the ship its alias names,
 * keyed by the client's messageId, so the same messageId again sends no
 * second message. The client is answered its task only once the fleet's
 * send answered OK: the message is stored before any answer, and the
 * gateway never answers OK itself. The task's id is the HMAC of the first
 * message's msg_ id. A message naming a task continues it, in reply to the
 * task's latest reply, or its latest message while none came. A blocking
 * send then waits for the answer as long as the capability states, at most
 * the gateway's own most (interop 5.3); else the task is answered as it
 * stands.
 */
import type { MessageId } from '@aeolus-fleet/common';

import type { ClientCall } from '../mcp-in/client-call.js';
import type { CallKeys, CallSender, ClientCalls, StoredTask } from '../mcp-in/ports.js';
import type { Sleep } from '../mcp-out/run-party.js';
import type { PartyStore } from '../parties/ports.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { A2aCaller } from './authenticate-a2a-client.js';
import type { FindReachedShip, FindReachedShipRefusal } from './find-reached-ship.js';
import { capabilityFor, contentOf, type InboundMessage } from './inbound-message.js';
import { taskViewOf, type TaskView } from './task-view.js';

/** The most a payload holds (decision 0006). */
export const PAYLOAD_MAX_BYTES = 65_536;

export type SendA2aMessageRefusal =
  | FindReachedShipRefusal
  | DomainError<'PAYLOAD_TOO_LARGE' | 'TASK_NOT_FOUND' | 'TASK_TERMINAL' | 'CONTEXT_MISMATCH' | 'NOT_REACHABLE' | 'SEND_REFUSED'>;

export type SendA2aMessage = (input: { caller: A2aCaller; alias: string; message: InboundMessage; isBlocking: boolean }) => Promise<Result<TaskView, SendA2aMessageRefusal>>;

interface SendA2aMessageDeps {
  parties: Pick<PartyStore, 'find'>;
  findReachedShip: FindReachedShip;
  sender: CallSender;
  calls: ClientCalls;
  keys: CallKeys;
  clock: Clock;
  sleep: Sleep;
  /** The most a send waits for its answer, whatever its capability states. */
  waitMaxMs: number;
  /** How often it reads the task while it waits. */
  waitPollMs: number;
}

/** No signal ends a wait early: it is bounded by its own time. */
const UNENDING = new AbortController().signal;

function refusalOf(refused: { code: string; message: string }): ReturnType<typeof refuse<SendA2aMessageRefusal['kind']>> {
  switch (refused.code) {
    // No reason why, and no ship named: the fleet's network rules are not the outside's to read.
    case 'NOT_REACHABLE':
      return refuse('NOT_REACHABLE', 'This client may not send to this agent now');
    case 'UNAVAILABLE':
      return refuse('FLEET_UNAVAILABLE', 'The message was not answered, so it may have been sent: send it again with the same messageId to send it at most once');
    default:
      return refuse('SEND_REFUSED', 'The message was refused');
  }
}

/** The message the follow-up replies to: the task's latest reply, or its latest message while none came. */
function inReplyToOf(task: StoredTask): MessageId | undefined {
  const replies = task.calls.flatMap((call) => call.replies).sort((left, right) => left.receivedAt.getTime() - right.receivedAt.getTime());
  return replies.at(-1)?.messageId ?? task.calls.at(-1)?.messageId;
}

const isTerminal = (view: TaskView) => view.status.state === 'completed' || view.status.state === 'failed';

export function createSendA2aMessage(deps: SendA2aMessageDeps): SendA2aMessage {
  /** The task as it stands once its answer came or the wait passed, read after each poll; it never sleeps past the wait's end. */
  const answerWithin = async (sent: { caller: A2aCaller; taskId: string; since: Date; waitMs: number }): Promise<TaskView | undefined> => {
    const waitEnd = sent.since.getTime() + Math.min(sent.waitMs, deps.waitMaxMs);
    for (;;) {
      const task = await deps.calls.findTask(sent.caller, sent.taskId);
      const view = task === undefined ? undefined : taskViewOf(task, deps.clock.now());
      const left = waitEnd - deps.clock.now().getTime();
      if (view === undefined || (view.status.state !== 'submitted' && view.status.state !== 'working') || left <= 0) {
        return view;
      }
      await deps.sleep(Math.min(deps.waitPollMs, left), UNENDING);
    }
  };

  /** The task the message continues, if it names one: refused when it is not the caller's, not this ship's, ended, or of another context. */
  const continued = async (caller: A2aCaller, sent: { message: InboundMessage; shipId: ClientCall['shipId'] }): Promise<Result<StoredTask | undefined, SendA2aMessageRefusal>> => {
    const { taskId, contextId } = sent.message;
    if (taskId === undefined) {
      return ok(undefined);
    }
    const task = await deps.calls.findTask(caller, taskId);
    if (task === undefined || task.calls.at(-1)?.shipId !== sent.shipId) {
      return refuse('TASK_NOT_FOUND', `No task ${taskId}`);
    }
    if (isTerminal(taskViewOf(task, deps.clock.now()))) {
      return refuse('TASK_TERMINAL', `The task ${taskId} has ended: send a new message without its taskId`);
    }
    if (contextId !== undefined && contextId !== task.contextId) {
      return refuse('CONTEXT_MISMATCH', `The task ${taskId} is in another context`);
    }
    return ok(task);
  };

  return async ({ caller, alias, message, isBlocking }) => {
    const ship = await deps.findReachedShip({ ...caller, alias });
    if (!ship.isOk) {
      return ship;
    }
    const content = contentOf(message);
    if (new TextEncoder().encode(content.payload).length > PAYLOAD_MAX_BYTES) {
      return refuse('PAYLOAD_TOO_LARGE', 'The message is over 64 KB: send where its content lives instead');
    }
    const task = await continued(caller, { message, shipId: ship.value.shipId });
    if (!task.isOk) {
      return task;
    }
    const party = await deps.parties.find(caller.fleetId, caller.party);
    if (party?.crewToken == null) {
      return refuse('PARTY_NOT_CREWED', `The party ${caller.party} is not crewed`);
    }
    const { statement } = ship.value;
    const capability = capabilityFor(statement?.by === 'crew' ? statement.capabilities : [], content.contentType);
    const inReplyTo = task.value === undefined ? undefined : inReplyToOf(task.value);
    const sent = await deps.sender.send(party.crewToken, {
      to: ship.value.shipId,
      ...content,
      idempotencyKey: deps.keys.idempotencyKeyOf({ ...caller, key: message.messageId }),
      ...(inReplyTo === undefined ? {} : { inReplyTo }),
    });
    if (!sent.isOk) {
      return refusalOf(sent.error);
    }
    const { messageId } = sent.value;
    const sentAt = deps.clock.now();
    const taskId = task.value?.taskId ?? deps.keys.handleOf(caller.fleetId, messageId);
    await deps.calls.saveTask({ ...caller, taskId, contextId: task.value?.contextId ?? message.contextId ?? deps.keys.contextIdOf(caller.fleetId, messageId), createdAt: sentAt });
    await deps.calls.save({
      ...caller,
      messageId,
      handle: deps.keys.handleOf(caller.fleetId, messageId),
      shipId: ship.value.shipId,
      capability: capability?.name ?? null,
      outputContentType: capability?.outputModes?.[0] ?? null,
      sentAt,
      deadlineAt: capability?.deadlineMs === undefined ? null : new Date(sentAt.getTime() + capability.deadlineMs),
      delivery: null,
      task: { taskId, message: message.asJson },
    });
    const view = await answerWithin({ caller, taskId, since: sentAt, waitMs: isBlocking ? (capability?.waitMs ?? 0) : 0 });
    return view === undefined ? refuse('TASK_NOT_FOUND', `No task ${taskId}`) : ok(view);
  };
}

