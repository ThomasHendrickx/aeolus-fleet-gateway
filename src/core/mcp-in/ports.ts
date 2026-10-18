import type { FleetId, MessageId, ShipId, ShipKind } from '@aeolus-fleet/common';

import type { FleetRefusal } from '../connection/ports.js';
import type { Result } from '../shared/result.js';

/** One thing a ship offers, as its statement says it (decision 0047): MCP's tool fields and A2A's modes. */
export interface Capability {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  /** The media types to send it, the first the one to use. */
  inputModes?: string[];
  /** The media types that come back, the first the one to expect. */
  outputModes?: string[];
}

/** A ship's statement as discovery shows it: its crew's, the note it was commissioned with, or none. */
export type DiscoveredStatement = { by: 'crew'; summary: string; capabilities: Capability[] } | { by: 'commission' } | null;

/** A ship the caller may send to now, as discover answers it. */
export interface DiscoveredShip {
  shipId: ShipId;
  kind: ShipKind;
  statement: DiscoveredStatement;
}

/** Outbound port: the fleet's discover, as a proxy ship's crew calls it. */
export interface Discovery {
  discover(crewToken: string): Promise<Result<DiscoveredShip[], FleetRefusal>>;
}

/**
 * Outbound port: the name an outside client knows a ship by. Derived, never
 * stored, the same for the same ship, and telling nothing of the ship's name
 * or id: the gateway translates both ways, as NAT does.
 */
export interface ShipAliases {
  aliasOf(fleetId: FleetId, shipId: ShipId): string;
}

/** Outbound port: the fleet's send, as a proxy ship's crew calls it. The same idempotency key answers the same message. */
export interface CallSender {
  send(crewToken: string, message: { to: ShipId; contentType: string; payload: string; idempotencyKey: string }): Promise<Result<{ messageId: MessageId }, FleetRefusal>>;
}

/**
 * Outbound port: the keys of an outside client's call, derived under the
 * gateway's own key. The outside sees only opaque ids, never a `msg_` id.
 */
export interface CallKeys {
  /** The send's key for a client's own idempotency key: the same for the same party and key. */
  idempotencyKeyOf(given: { fleetId: FleetId; party: string; key: string }): string;
  /** A new send key, for a call the client gave none. */
  newIdempotencyKey(): string;
  /** The handle the client reads its call by. */
  handleOf(fleetId: FleetId, messageId: MessageId): string;
}

/** An outside client's call: the message its proxy ship sent, and the handle the client knows it by. */
export interface ClientCall {
  fleetId: FleetId;
  party: string;
  messageId: MessageId;
  handle: string;
  shipId: ShipId;
  capability: string;
  sentAt: Date;
}

/** Outbound port: outside clients' calls, one per message. */
export interface ClientCalls {
  /** Keeps a call; a call kept for its message already stays as it was. */
  save(call: ClientCall): Promise<void>;
  /** The party's call by its handle; none of another party's. */
  findByHandle(caller: { fleetId: FleetId; party: string }, handle: string): Promise<ClientCall | undefined>;
}
