import { idSchema, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';

import type { CallReply, ClientCall } from '../../src/core/mcp-in/client-call.js';
import type { CallKeys, CallSender, ClientCalls, DiscoveredShip, Discovery, ReceivedReply, ReplyReceiver, ShipAliases } from '../../src/core/mcp-in/ports.js';
import { err, ok } from '../../src/core/shared/result.js';
import { FLEET_ID } from './fleet-fakes.js';
import type { FleetRefusal } from '../../src/core/connection/ports.js';

export const CRM_SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9cr2';
export const ARGO_SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9arg';

/** Aliases as a test reads them: the ship id's last four characters, spelled out. */
export const fakeAliases: ShipAliases = { aliasOf: (_fleetId: FleetId, shipId: ShipId) => `a${shipId.slice(-4)}` };

/** A ship as discover answers it, with a statement by its crew. */
export function aDiscoveredShip(overrides: Partial<DiscoveredShip> = {}): DiscoveredShip {
  return {
    shipId: CRM_SHIP_ID,
    kind: 'app',
    statement: {
      by: 'crew',
      summary: 'The CRM: contacts and deals.',
      capabilities: [
        {
          name: 'list_deals',
          title: 'List deals',
          description: "Lists a contact's deals.",
          inputSchema: { type: 'object', properties: { contactId: { type: 'string' } }, required: ['contactId'] },
          outputSchema: { type: 'object', properties: { deals: { type: 'array' } } },
          inputModes: ['application/vnd.aeolus.mcp-tool+json; name=list_deals'],
          outputModes: ['application/vnd.aeolus.mcp-result+json; name=list_deals'],
          waitMs: 10_000,
          deadlineMs: 600_000,
        },
      ],
    },
    ...overrides,
  };
}

/** The fleet's discover, as the proxy ship's crew calls it: the ships set, or the refusal set. */
export function fakeDiscovery(ships: DiscoveredShip[] = [aDiscoveredShip()]) {
  const state: { ships: DiscoveredShip[]; refusal: FleetRefusal | undefined } = { ships, refusal: undefined };
  const askedWith: string[] = [];
  const discovery: Discovery & { state: typeof state; askedWith: string[] } = {
    state,
    askedWith,
    discover: (crewToken) => {
      askedWith.push(crewToken);
      return Promise.resolve(state.refusal === undefined ? ok(state.ships) : err(state.refusal));
    },
  };
  return discovery;
}

export const MESSAGE_ID: MessageId = 'msg_01m3tbfspe96yf1rnr4ank9m01';

/** Keys as a test reads them: what each is derived from, spelled out. */
export function fakeCallKeys(): CallKeys & { drawn: number } {
  const keys = {
    drawn: 0,
    idempotencyKeyOf: ({ fleetId, party, key }: { fleetId: FleetId; party: string; key: string }) => `key(${fleetId}:${party}:${key})`,
    newIdempotencyKey: () => {
      keys.drawn += 1;
      return `new-${String(keys.drawn)}`;
    },
    handleOf: (fleetId: FleetId, messageId: MessageId) => `handle(${fleetId}:${messageId})`,
  };
  return keys;
}

/** The fleet's send, as a proxy ship's crew calls it: the same key answers the same message, as core does. */
export function fakeCallSender() {
  const state: { refusal: FleetRefusal | undefined } = { refusal: undefined };
  const sent: { crewToken: string; to: ShipId; contentType: string; payload: string; idempotencyKey: string }[] = [];
  const sender: CallSender & { state: typeof state; sent: typeof sent } = {
    state,
    sent,
    send: (crewToken, message) => {
      if (state.refusal !== undefined) {
        return Promise.resolve(err(state.refusal));
      }
      if (!sent.some((earlier) => earlier.idempotencyKey === message.idempotencyKey)) {
        sent.push({ crewToken, ...message });
      }
      const index = sent.findIndex((earlier) => earlier.idempotencyKey === message.idempotencyKey);
      return Promise.resolve(ok({ messageId: index === 0 ? MESSAGE_ID : idSchema('message').parse(`msg_01m3tbfspe96yf1rnr4ank9m${String(index).padStart(2, '0')}`) }));
    },
  };
  return sender;
}

/** A call an outside client made: sent, with no reply yet. */
export function aClientCall(overrides: Partial<ClientCall> = {}): ClientCall {
  return {
    fleetId: FLEET_ID,
    party: 'claude',
    messageId: MESSAGE_ID,
    handle: 'handle-1',
    shipId: CRM_SHIP_ID,
    capability: 'list_deals',
    outputContentType: null,
    sentAt: new Date('2026-10-19T12:00:00.000Z'),
    deadlineAt: new Date('2026-10-19T12:10:00.000Z'),
    replies: [],
    ...overrides,
  };
}

/** A reply to a call, as the gateway kept it. */
export function aCallReply(overrides: Partial<CallReply> = {}): CallReply {
  return {
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9r01',
    messageId: 'msg_01m3tbfspe96yf1rnr4ank9r01',
    contentType: 'text/plain',
    payload: 'Two deals.',
    receivedAt: new Date('2026-10-19T12:01:00.000Z'),
    ...overrides,
  };
}

/** The calls of outside clients in memory, by fleet and message, with their replies in the order kept. */
export function memoryClientCalls(): ClientCalls & { held: ClientCall[]; isFailing: boolean } {
  const store = {
    held: new Array<ClientCall>(),
    /** Whether keeping a reply fails, as a database that does not answer. */
    isFailing: false,
  };
  const find = (fleetId: FleetId, messageId: MessageId) => store.held.find((call) => call.fleetId === fleetId && call.messageId === messageId);
  return Object.assign(store, {
    save: (call: Omit<ClientCall, 'replies'>) => {
      if (!find(call.fleetId, call.messageId)) {
        store.held.push({ ...call, replies: [] });
      }
      return Promise.resolve();
    },
    addReply: ({ fleetId, messageId }: { fleetId: FleetId; messageId: MessageId }, reply: CallReply) => {
      if (store.isFailing) {
        return Promise.reject(new Error('The database did not answer'));
      }
      const call = find(fleetId, messageId);
      if (call && !call.replies.some((kept) => kept.deliveryId === reply.deliveryId)) {
        call.replies.push(reply);
      }
      return Promise.resolve();
    },
    findByMessage: (fleetId: FleetId, messageId: MessageId) => Promise.resolve(find(fleetId, messageId)),
    waitedOn: ({ fleetId, party }: { fleetId: FleetId; party: string }, now: Date) =>
      Promise.resolve(store.held.filter((call) => call.fleetId === fleetId && call.party === party && (call.deadlineAt === null || call.deadlineAt.getTime() > now.getTime()))),
    findByHandle: ({ fleetId, party }: { fleetId: FleetId; party: string }, handle: string) =>
      Promise.resolve(store.held.find((call) => call.fleetId === fleetId && call.party === party && call.handle === handle)),
  });
}

/**
 * The fleet's receiveReply, as a proxy ship's crew calls it: each message's
 * replies, handed one at a time and again until acknowledged, none once
 * none waits; or the refusal set. It counts the calls in flight at once.
 */
interface ReplyFleet {
  replies: Map<MessageId, ReceivedReply[]>;
  refusal: FleetRefusal | undefined;
  asked: { crewToken: string; messageId: MessageId }[];
  inFlight: number;
  mostInFlight: number;
}

export function fakeReplyReceiver() {
  const state: ReplyFleet = {
    replies: new Map<MessageId, ReceivedReply[]>(),
    refusal: undefined,
    asked: [],
    inFlight: 0,
    mostInFlight: 0,
  };
  const receiver: ReplyReceiver = {
    receiveReply: async (crewToken, { messageId }) => {
      state.asked.push({ crewToken, messageId });
      state.inFlight += 1;
      state.mostInFlight = Math.max(state.mostInFlight, state.inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      state.inFlight -= 1;
      if (state.refusal !== undefined) {
        return err(state.refusal);
      }
      return ok(state.replies.get(messageId)?.[0]);
    },
  };
  /** The fleet took the acknowledgement of a delivery: it hands it no more. */
  const acknowledged = (deliveryId: string) => {
    for (const [messageId, replies] of state.replies) {
      state.replies.set(messageId, replies.filter((reply) => reply.deliveryId !== deliveryId));
    }
  };
  return { state, receiver, acknowledged };
}
