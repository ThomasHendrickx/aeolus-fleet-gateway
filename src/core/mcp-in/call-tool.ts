/**
 * Use case: an outside MCP client calls a tool (interop 3.3). The call is a
 * message the party's proxy ship sends to the tool's ship, and the client is
 * answered a handle only once the fleet's send answered OK: the message is
 * stored before any answer, and the gateway never answers OK itself. It
 * then waits for the answer as long as the capability states, at most the
 * gateway's own most (interop 3.3, 5.3): answered within it, the client gets
 * the answer itself; else its handle and the state. The call fails at the
 * capability's deadline, and never by time when it states none (3.4).
 */
import type { FleetId, MessageId } from '@aeolus-fleet/common';

import type { Sleep } from '../mcp-out/run-party.js';
import type { PartyStore } from '../parties/ports.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { IDEMPOTENCY_ARGUMENT, type ListedTool, type ListTools } from './list-tools.js';
import type { CallKeys, CallSender, ClientCalls } from './ports.js';
import { readCallOf, type ReadCall } from './read-client-call.js';

export type CallToolRefusal = DomainError<'PARTY_NOT_CREWED' | 'FLEET_UNAVAILABLE' | 'NO_SUCH_TOOL' | 'INVALID_ARGUMENTS' | 'NOT_REACHABLE' | 'SEND_REFUSED'>;

export type CallTool = (
  caller: { fleetId: FleetId; party: string },
  call: { name: string; arguments: Record<string, unknown> },
) => Promise<Result<ReadCall, CallToolRefusal>>;

interface CallToolDeps {
  parties: PartyStore;
  listTools: ListTools;
  sender: CallSender;
  calls: ClientCalls;
  keys: CallKeys;
  clock: Clock;
  sleep: Sleep;
  /** The most a call waits for its answer before it is answered its handle, whatever its capability states. */
  waitMaxMs: number;
  /** How often it reads the call while it waits. */
  waitPollMs: number;
}

/** The message's payload: the arguments as JSON, or a text tool's one text; none for arguments that do not fit the tool. */
function payloadOf(tool: ListedTool, values: Record<string, unknown>): string | undefined {
  if (tool.target.isText) {
    return typeof values.text === 'string' ? values.text : undefined;
  }
  return JSON.stringify(values);
}

function refusalOf(refused: { code: string; message: string }): ReturnType<typeof refuse<CallToolRefusal['kind']>> {
  switch (refused.code) {
    // No reason why: the fleet's network rules are not the outside's to read.
    case 'NOT_REACHABLE':
      return refuse('NOT_REACHABLE', 'This party may not call that tool now');
    case 'UNAVAILABLE':
      return refuse('FLEET_UNAVAILABLE', `The fleet did not answer, so the call may have been sent: call again with the same ${IDEMPOTENCY_ARGUMENT} to send it at most once`);
    default:
      return refuse('SEND_REFUSED', `The fleet refused the call: ${refused.message}`);
  }
}

/** No signal ends a wait early: it is bounded by its own time. */
const UNENDING = new AbortController().signal;

/** The call as it stands once its answer came or the wait passed, read after each poll; it never sleeps past the wait's end. */
async function answerWithin(deps: CallToolDeps, sent: { fleetId: FleetId; messageId: MessageId; handle: string; since: Date; waitMs: number }): Promise<ReadCall> {
  const waitEnd = sent.since.getTime() + Math.min(sent.waitMs, deps.waitMaxMs);
  for (;;) {
    const call = await deps.calls.findByMessage(sent.fleetId, sent.messageId);
    const read = call ? readCallOf(call, deps.clock.now()) : { handle: sent.handle, createdAt: sent.since, updatedAt: sent.since, state: 'submitted' as const };
    const left = waitEnd - deps.clock.now().getTime();
    if (read.state === 'completed' || read.state === 'failed' || left <= 0) {
      return read;
    }
    await deps.sleep(Math.min(deps.waitPollMs, left), UNENDING);
  }
}

export function createCallTool(deps: CallToolDeps): CallTool {
  return async (caller, call) => {
    const listed = await deps.listTools(caller);
    if (!listed.isOk) {
      return listed;
    }
    const tool = listed.value.find((each) => each.name === call.name);
    if (!tool) {
      return refuse('NO_SUCH_TOOL', `No tool ${call.name} is offered to this party now`);
    }
    const { [IDEMPOTENCY_ARGUMENT]: key, ...values } = call.arguments;
    if (key !== undefined && (typeof key !== 'string' || key.length === 0)) {
      return refuse('INVALID_ARGUMENTS', `${IDEMPOTENCY_ARGUMENT} is a string of at least one character`);
    }
    const payload = payloadOf(tool, values);
    if (payload === undefined) {
      return refuse('INVALID_ARGUMENTS', 'This tool takes one text argument, a string');
    }
    const party = await deps.parties.find(caller.fleetId, caller.party);
    if (party?.crewToken == null) {
      return refuse('PARTY_NOT_CREWED', `The party ${caller.party} is not crewed: argo crews it on the parties page`);
    }
    const idempotencyKey = key === undefined ? deps.keys.newIdempotencyKey() : deps.keys.idempotencyKeyOf({ ...caller, key });
    const sent = await deps.sender.send(party.crewToken, { to: tool.target.shipId, contentType: tool.target.contentType, payload, idempotencyKey });
    if (!sent.isOk) {
      return refusalOf(sent.error);
    }
    const { messageId } = sent.value;
    const handle = deps.keys.handleOf(caller.fleetId, messageId);
    const sentAt = deps.clock.now();
    await deps.calls.save({
      fleetId: caller.fleetId,
      party: caller.party,
      messageId,
      handle,
      shipId: tool.target.shipId,
      capability: tool.target.capability,
      outputContentType: tool.target.outputContentType,
      sentAt,
      deadlineAt: tool.target.deadlineMs === null ? null : new Date(sentAt.getTime() + tool.target.deadlineMs),
    });
    return ok(await answerWithin(deps, { fleetId: caller.fleetId, messageId, handle, since: sentAt, waitMs: tool.target.waitMs }));
  };
}
