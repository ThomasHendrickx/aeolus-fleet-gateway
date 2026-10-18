import { idSchema, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';

import type { CallKeys, CallSender, ClientCall, ClientCalls, DiscoveredShip, Discovery, ShipAliases } from '../../src/core/mcp-in/ports.js';
import { err, ok } from '../../src/core/shared/result.js';
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
    idempotencyKeyOf: (fleetId: FleetId, party: string, key: string) => `key(${fleetId}:${party}:${key})`,
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

/** The calls of outside clients in memory, by fleet and message. */
export function memoryClientCalls(): ClientCalls & { held: ClientCall[] } {
  const held: ClientCall[] = [];
  return {
    held,
    save: (call) => {
      if (!held.some((earlier) => earlier.fleetId === call.fleetId && earlier.messageId === call.messageId)) {
        held.push(call);
      }
      return Promise.resolve();
    },
    findByHandle: (fleetId, party, handle) => Promise.resolve(held.find((call) => call.fleetId === fleetId && call.party === party && call.handle === handle)),
  };
}
