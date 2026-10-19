import { PAYLOAD_MAX_BYTES, payloadBytes, type DeliveryId, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { McpServerParty } from '../parties/party.js';
import type { Result } from '../shared/result.js';
import { toolCalledBy, toolInputType, toolResultType } from './content-types.js';
import type { McpServers, ToolResult } from './ports.js';
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
  handed(crewToken: string, handOver: { deliveryId: DeliveryId; handOverNumber: number }): Promise<Result<'handed' | 'acknowledged' | 'undeliverable', FleetRefusal>>;
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
 * marked its tool repeatable; otherwise it is reported not handled.
 */
export function createHandCall(deps: { crew: ProxyShipCrew; servers: McpServers; calls: CallStore; marks: ToolMarks; timeoutMs: number }): HandCall {
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
      // Core 0.27 refuses this for a delivery never handed once more (aeolus-fleet#955); the call stays judged, and is reported again each time it comes.
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

    const handed = await deps.crew.handed(crewToken, { deliveryId: delivery.deliveryId, handOverNumber: (delivery.handOverNumber ?? 0) + 1 });
    if (!handed.isOk) {
      return AGAIN;
    }
    if (handed.value === 'undeliverable') {
      return { kind: 'undeliverable' };
    }
    await deps.calls.save({ ...kept, state: 'calling', reply: null });
    const outcome = await deps.servers.callTool({ url: party.url, credential: party.credential }, { name: tool, arguments: args, timeoutMs: deps.timeoutMs });
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

