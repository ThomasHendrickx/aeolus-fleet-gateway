import type { DeliveryId, FleetId, ShipId } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../../src/core/connection/ports.js';
import type { Call, CallStore, ProxyShipCrew, PushedDelivery, Reply } from '../../src/core/mcp-out/hand-call.js';
import type { McpServerConnection, McpServers, OutsideTool, ToolCall, ToolCallOutcome } from '../../src/core/mcp-out/ports.js';
import type { StatementDoor, ToolMarks } from '../../src/core/mcp-out/state-party.js';
import type { Statement } from '../../src/core/mcp-out/statement.js';
import { err, ok } from '../../src/core/shared/result.js';

/** Two tools of a CRM, as its tools/list answers them. */
export const CRM_TOOLS: OutsideTool[] = [
  { name: 'list_contacts', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
  { name: 'create_deal', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false, idempotentHint: false } },
];

/** An outside MCP server that lists its tools while reachable, and ends each call as set; it records each connection it was listed with, and each call. */
export function fakeMcpServers(tools: OutsideTool[] = CRM_TOOLS) {
  const state: { isReachable: boolean; outcome: ToolCallOutcome } = { isReachable: true, outcome: { kind: 'answered', result: { content: [], isError: false } } };
  const listedWith: McpServerConnection[] = [];
  const called: { connection: McpServerConnection; call: ToolCall }[] = [];
  const servers: McpServers & { state: typeof state; listedWith: McpServerConnection[]; called: typeof called } = {
    state,
    listedWith,
    called,
    listTools: (connection) => {
      listedWith.push(connection);
      return Promise.resolve(state.isReachable ? ok(tools) : err({ kind: 'unreachable' as const, reason: 'connect ECONNREFUSED' }));
    },
    callTool: (connection, call) => {
      called.push({ connection, call });
      return Promise.resolve(state.outcome);
    },
  };
  return servers;
}

/** The fleet's setStatement, as a proxy ship's crew calls it: it keeps each statement, or refuses with the refusal set. */
export function fakeStatementDoor() {
  const state: { refusal: FleetRefusal | undefined } = { refusal: undefined };
  const stated: { crewToken: string; statement: Statement }[] = [];
  const door: StatementDoor & { state: typeof state; stated: typeof stated } = {
    state,
    stated,
    setStatement: (crewToken, statement) => {
      if (state.refusal !== undefined) {
        return Promise.resolve(err(state.refusal));
      }
      stated.push({ crewToken, statement });
      return Promise.resolve(ok(undefined));
    },
  };
  return door;
}

/** argo's repeatable marks in memory: the marked tools of each party, by fleet and party. */
export function memoryToolMarks(): ToolMarks & { held: Map<string, Set<string>> } {
  const held = new Map<string, Set<string>>();
  const key = (fleetId: FleetId, party: string) => JSON.stringify([fleetId, party]);
  return {
    held,
    repeatable: (fleetId, party) => Promise.resolve(new Set(held.get(key(fleetId, party)))),
    mark: (fleetId, { party, tool, isRepeatable }) => {
      const tools = held.get(key(fleetId, party)) ?? new Set<string>();
      if (isRepeatable) {
        tools.add(tool);
      } else {
        tools.delete(tool);
      }
      held.set(key(fleetId, party), tools);
      return Promise.resolve();
    },
  };
}

export const CALLER_SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9agt';

/** A tool call to the CRM's list_deals, as the proxy ship's pushReceive answers it. */
export function aPushedDelivery(overrides: Partial<PushedDelivery> = {}): PushedDelivery {
  return {
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9d01',
    messageId: 'msg_01m3tbfspe96yf1rnr4ank9m01',
    senderShipId: CALLER_SHIP_ID,
    contentType: 'application/vnd.aeolus.mcp-tool+json; name=list_deals',
    payload: '{"contactId":"c1"}',
    state: 'received',
    handOverNumber: null,
    inReplyTo: null,
    ...overrides,
  };
}

type CrewCall = ['handed', { deliveryId: DeliveryId; handOverNumber: number }] | ['send', Reply] | ['ack' | 'handled', DeliveryId] | ['notHandled', { deliveryId: DeliveryId; reason: string }];

/** A proxy ship's crew calls, as the fleet answers them: each one made is logged, in order. */
export function fakeProxyShipCrew() {
  const state: {
    handedState: 'handed' | 'acknowledged' | 'undeliverable';
    handedRefusal: FleetRefusal | undefined;
    notHandledRefusal: FleetRefusal | undefined;
    isSendAnswering: boolean;
    receiveRefusal: FleetRefusal | undefined;
    /** Whether each acknowledgement is lost: the fleet does not answer it, and hands its delivery again. */
    isAckLost: boolean;
    waiting: PushedDelivery[];
  } = { handedState: 'handed', handedRefusal: undefined, notHandledRefusal: undefined, isSendAnswering: true, receiveRefusal: undefined, isAckLost: false, waiting: [] };
  const received: number[] = [];
  const log: CrewCall[] = [];
  const crewTokens: string[] = [];
  const done = (crewToken: string, call: CrewCall) => {
    crewTokens.push(crewToken);
    log.push(call);
  };
  const crew: ProxyShipCrew & { state: typeof state; log: CrewCall[]; crewTokens: string[]; received: number[]; sent: () => Reply[] } = {
    state,
    log,
    crewTokens,
    received,
    sent: () => log.flatMap((call) => (call[0] === 'send' ? [call[1]] : [])),
    pushReceive: (crewToken, { max }) => {
      crewTokens.push(crewToken);
      received.push(max);
      return Promise.resolve(state.receiveRefusal === undefined ? ok(state.waiting.slice(0, max)) : err(state.receiveRefusal));
    },
    handed: (crewToken, handOver) => {
      if (state.handedRefusal !== undefined) {
        return Promise.resolve(err(state.handedRefusal));
      }
      done(crewToken, ['handed', handOver]);
      return Promise.resolve(ok(state.handedState));
    },
    reply: (crewToken, reply) => {
      if (!state.isSendAnswering) {
        return Promise.resolve(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }));
      }
      done(crewToken, ['send', reply]);
      return Promise.resolve(ok(undefined));
    },
    ack: (crewToken, deliveryId) => {
      if (state.isAckLost) {
        return Promise.resolve(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }));
      }
      done(crewToken, ['ack', deliveryId]);
      // An acknowledged delivery is not handed again, as core's is not.
      state.waiting = state.waiting.filter((waiting) => waiting.deliveryId !== deliveryId);
      return Promise.resolve(ok(undefined));
    },
    handled: (crewToken, deliveryId) => {
      done(crewToken, ['handled', deliveryId]);
      return Promise.resolve(ok(undefined));
    },
    notHandled: (crewToken, report) => {
      done(crewToken, ['notHandled', report]);
      return Promise.resolve(state.notHandledRefusal === undefined ? ok(undefined) : err(state.notHandledRefusal));
    },
  };
  return crew;
}

/** The gateway's calls in memory, by delivery. */
export function memoryCalls(): CallStore & { held: Map<DeliveryId, Call> } {
  const held = new Map<DeliveryId, Call>();
  return {
    held,
    find: (deliveryId) => Promise.resolve(held.get(deliveryId)),
    save: (call) => {
      held.set(call.deliveryId, call);
      return Promise.resolve();
    },
  };
}
