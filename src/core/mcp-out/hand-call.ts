import { PAYLOAD_MAX_BYTES, payloadBytes, type DeliveryId, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { CheckRequiredScopes } from '../parties/check-required-scopes.js';
import type { McpServerParty } from '../parties/party.js';
import type { PartyStore, ScopeRequirementsStore } from '../parties/ports.js';
import { scopesNeeded } from '../parties/scope-requirements.js';
import { isToolOn, TOOL_NOT_ENABLED } from '../parties/tool-switches.js';
import type { Result } from '../shared/result.js';
import { toolCalledBy, toolInputType, toolResultType } from './content-types.js';
import type { GrantCalls } from './grant-calls.js';
import type { McpServers, ToolCall, ToolCallOutcome, ToolResult } from './ports.js';
import type { ToolMarks } from './state-party.js';

/** A delivery to a proxy ship, as its pushReceive hands it: received, or handed before under this lease with its last number. */
export interface PushedDelivery {
  readonly deliveryId: DeliveryId;
  readonly messageId: MessageId;
  readonly senderShipId: ShipId;
  readonly contentType: string;
  readonly payload: string;
  readonly state: 'received' | 'handed';
  readonly handOverNumber: number | null;
  /** The message this one replies to, if any. */
  readonly inReplyTo: MessageId | null;
}

/** A reply naming the request, sent as the proxy ship. */
export interface Reply {
  readonly to: ShipId;
  readonly inReplyTo: MessageId;
  readonly contentType: string;
  readonly payload: string;
  readonly idempotencyKey: string;
}

/** Outbound port: the fleet's calls a proxy ship's crew makes (decision 0040), each with its crew token. */
export interface ProxyShipCrew {
  /** Its deliveries, up to max: its own in flight first, then pending ones, each received; it waits a while for one, or less once the signal aborts. */
  pushReceive(crewToken: string, take: { max: number; signal: AbortSignal }): Promise<Result<PushedDelivery[], FleetRefusal>>;
  /** Hands the delivery over with its number, naming the channel it went through (interop 5.1). */
  handed(crewToken: string, handOver: { deliveryId: DeliveryId; handOverNumber: number; channel: string }): Promise<Result<'handed' | 'acknowledged' | 'undeliverable', FleetRefusal>>;
  reply(crewToken: string, reply: Reply): Promise<Result<void, FleetRefusal>>;
  ack(crewToken: string, deliveryId: DeliveryId): Promise<Result<void, FleetRefusal>>;
  handled(crewToken: string, deliveryId: DeliveryId): Promise<Result<void, FleetRefusal>>;
  notHandled(crewToken: string, report: { deliveryId: DeliveryId; reason: string }): Promise<Result<void, FleetRefusal>>;
}

/**
 * What the gateway keeps of a call, so a restart never calls again what may have run:
 * - calling: handed, and its `tools/call` sent or about to be;
 * - notSent: the server was not reached, so nothing ran;
 * - answered: the server answered, and its reply is kept until it is sent;
 * - mayHaveRun: sent with no answer, and its tool is not marked repeatable;
 * - done: replied, acknowledged and handled.
 */
export interface Call {
  readonly deliveryId: DeliveryId;
  readonly fleetId: FleetId;
  readonly party: string;
  readonly state: 'calling' | 'notSent' | 'answered' | 'mayHaveRun' | 'done';
  readonly reply: Reply | null;
}

/** Outbound port: the gateway's calls, by delivery. */
export interface CallStore {
  find(deliveryId: DeliveryId): Promise<Call | undefined>;
  save(call: Call): Promise<void>;
}

/**
 * How handing one delivery ended:
 * - handled: replied, acknowledged and handled;
 * - again: nothing ran, or running it again is safe: the delivery comes again in flight, to be handed with the next number;
 * - notHandled: the call may have run and its answer was lost, so a human decides (5.2, option a);
 * - undeliverable: the fifth attempt; nothing is handed.
 */
export type HandOutcome = { readonly kind: 'handled' } | { readonly kind: 'again' } | { readonly kind: 'notHandled' } | { readonly kind: 'undeliverable' };

export type HandCall = (input: { party: McpServerParty; delivery: PushedDelivery }) => Promise<HandOutcome>;

/** The channel the gateway hands a proxy ship's delivery through: its outside MCP server (interop 5.1). */
const MCP_CHANNEL = 'mcp';

/** The reason a call that may have run is not handled, as Needs attention shows it. */
export const MAY_HAVE_RUN = 'The call may have run; its answer was lost. Check the outside system, then resend or dismiss.';

const AGAIN = { kind: 'again' } as const;

function isArguments(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function argumentsOf(payload: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(payload);
    return isArguments(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/** The reply carrying a tool's result; one too large for a message is replaced by an error result that says so. */
function resultReply(delivery: PushedDelivery, call: { tool: string; result: ToolResult }): Reply {
  const payload = JSON.stringify(call.result);
  const bytes = payloadBytes(payload);
  return {
    to: delivery.senderShipId,
    inReplyTo: delivery.messageId,
    contentType: toolResultType(call.tool),
    payload: bytes > PAYLOAD_MAX_BYTES ? JSON.stringify(errorResult(`The tool result is ${String(bytes)} bytes as JSON, over the ${String(PAYLOAD_MAX_BYTES)} a message holds.`)) : payload,
    idempotencyKey: `mcp-result:${delivery.messageId}`,
  };
}

function notACallReply(party: McpServerParty, delivery: PushedDelivery): Reply {
  return {
    to: delivery.senderShipId,
    inReplyTo: delivery.messageId,
    contentType: 'text/plain',
    payload: `${party.name} takes only tool calls: send a capability's input type, ${toolInputType('<tool>')}, with the tool arguments as a JSON object.`,
    idempotencyKey: `mcp-result:${delivery.messageId}`,
  };
}

/**
 * Use case: the gateway hands one delivery of a party's proxy ship to its
 * outside MCP server, as 0040 hands one to an agent (interop 5.2): handed
 * with the next number, then `tools/call`; the server's answer confirms it,
 * so it is replied, acknowledged and handled at once. The answer is kept
 * before the reply, so a restart replies again under the same key and calls
 * nothing. A call that died unanswered is handed again only where argo
 * marked its tool repeatable; otherwise it is reported not handled. A call
 * to a tool not switched on is answered an error and reaches no server
 * (aeolus-fleet#1151); so is a call from a ship that lacks a scope the
 * tool needs (design gateway-scopes, 4.2). A call to a server where each
 * person signs in goes out under its asking ship's owner's grant, read at
 * hand-over (decision 0067); one with no grant to go under is answered its
 * error result, kept first, and reaches no server.
 */
export function createHandCall(deps: {
  crew: ProxyShipCrew;
  servers: McpServers;
  calls: CallStore;
  marks: ToolMarks;
  parties: PartyStore;
  requirements: ScopeRequirementsStore;
  checkScopes: CheckRequiredScopes;
  grantCalls: GrantCalls;
  timeoutMs: number;
}): HandCall {
  return async ({ party, delivery }) => {
    const crewToken = party.crewToken;
    if (crewToken === null) {
      return AGAIN;
    }
    const kept = { deliveryId: delivery.deliveryId, fleetId: party.fleetId, party: party.name };

    const finish = async (reply: Reply): Promise<HandOutcome> => {
      for (const step of [() => deps.crew.reply(crewToken, reply), () => deps.crew.ack(crewToken, delivery.deliveryId), () => deps.crew.handled(crewToken, delivery.deliveryId)]) {
        if (!(await step()).isOk) {
          return AGAIN;
        }
      }
      await deps.calls.save({ ...kept, state: 'done', reply });
      return { kind: 'handled' };
    };
    const mayHaveRun = async (): Promise<HandOutcome> => {
      await deps.calls.save({ ...kept, state: 'mayHaveRun', reply: null });
      // A refused report leaves the call judged: it is reported again each time it comes, and never called again.
      await deps.crew.notHandled(crewToken, { deliveryId: delivery.deliveryId, reason: MAY_HAVE_RUN });
      return { kind: 'notHandled' };
    };

    const call = await deps.calls.find(delivery.deliveryId);
    if (call?.state === 'mayHaveRun') {
      return mayHaveRun();
    }
    if (call?.reply) {
      return finish(call.reply);
    }
    const tool = toolCalledBy(delivery.contentType);
    if (tool === undefined) {
      return finish(notACallReply(party, delivery));
    }
    const args = argumentsOf(delivery.payload);
    if (args === undefined) {
      return finish(resultReply(delivery, { tool, result: errorResult('The tool arguments must be a JSON object.') }));
    }
    const isRepeatable = (await deps.marks.repeatable(party.fleetId, party.name)).has(tool);
    // Handed before with no answer kept and not judged unsent: the gateway stopped mid call, so it may have run.
    if (delivery.state === 'handed' && call?.state !== 'notSent' && !isRepeatable) {
      return mayHaveRun();
    }

    // The switches as they are now, not as the worker found the party: an approver may switch a tool off while it runs.
    const now = await deps.parties.find(party.fleetId, party.name);
    if (!isToolOn(now?.kind === 'mcpServer' ? now.toolSwitches : party.toolSwitches, tool)) {
      return finish(resultReply(delivery, { tool, result: errorResult(TOOL_NOT_ENABLED) }));
    }
    // The requirements and the sender's scopes as they are now, at hand-over: either may change while a call waits.
    const needed = scopesNeeded(await deps.requirements.find(party.fleetId, party.name), tool);
    const checked = await deps.checkScopes({ fleetId: party.fleetId, senderShipId: delivery.senderShipId, needing: tool, needed });
    switch (checked.kind) {
      case 'unread':
        return AGAIN;
      case 'lacks':
        return finish(resultReply(delivery, { tool, result: errorResult(checked.message) }));
      case 'holds':
        break;
    }
    // The grant as it is now, at hand-over: one removed while the call waited refuses it, one signed in lets it through.
    let callTool = (call: ToolCall): Promise<ToolCallOutcome> => deps.servers.callTool({ url: party.url, credential: party.credential }, call);
    const { credential } = party;
    if (credential.kind === 'personSignIn') {
      const found = await deps.grantCalls.grantOf({ server: { fleetId: party.fleetId, name: party.name, url: party.url, client: credential.client }, senderShipId: delivery.senderShipId });
      switch (found.kind) {
        case 'unread':
          return AGAIN;
        case 'refused': {
          const reply = resultReply(delivery, { tool, result: found.result });
          await deps.calls.save({ ...kept, state: 'answered', reply });
          return finish(reply);
        }
        case 'granted':
          callTool = (call) => deps.grantCalls.callUnder(found.granted, call);
          break;
      }
    }

    const handed = await deps.crew.handed(crewToken, { deliveryId: delivery.deliveryId, handOverNumber: (delivery.handOverNumber ?? 0) + 1, channel: MCP_CHANNEL });
    if (!handed.isOk) {
      return AGAIN;
    }
    if (handed.value === 'undeliverable') {
      return { kind: 'undeliverable' };
    }
    await deps.calls.save({ ...kept, state: 'calling', reply: null });
    const outcome = await callTool({ name: tool, arguments: args, timeoutMs: deps.timeoutMs });
    switch (outcome.kind) {
      case 'answered': {
        const reply = resultReply(delivery, { tool, result: outcome.result });
        await deps.calls.save({ ...kept, state: 'answered', reply });
        return finish(reply);
      }
      case 'notSent':
        await deps.calls.save({ ...kept, state: 'notSent', reply: null });
        return AGAIN;
      case 'unanswered':
        return isRepeatable ? AGAIN : mayHaveRun();
    }
  };
}

