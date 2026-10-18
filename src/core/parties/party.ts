import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { McpServerCredential } from '../vault/credential.js';

/**
 * Where an approved party's proxy ship stands (interop I-5):
 * - commissioning: argo approved it; the gateway has not seen the fleet commission its ship yet;
 * - awaitingCrew: its ship is commissioned, and the gateway does not hold its crew token;
 * - crewed: the gateway crews its ship.
 */
export type PartyState = 'commissioning' | 'awaitingCrew' | 'crewed';

/**
 * An outside MCP server argo approved for its fleet: one app proxy ship
 * (decision 0044), owned by the person inside who answers for it (0045),
 * crewed by the gateway. Known by its ship's name, unique in the fleet.
 */
export interface Party {
  readonly fleetId: FleetId;
  readonly name: string;
  readonly kind: 'mcpServer';
  /** The server's Streamable HTTP endpoint. */
  readonly url: string;
  readonly credential: McpServerCredential;
  /** The owner argo picked: a person's ship, or argo. */
  readonly ownerShipId: ShipId;
  /** The most calls the gateway has in flight to the server at once. */
  readonly concurrencyLimit: number;
  readonly state: PartyState;
  readonly proxyShipId: ShipId | null;
  /** The proxy ship's secret, kept only from its commission until the gateway crews it, so a crash between them loses nothing. */
  readonly secret: string | null;
  readonly crewToken: string | null;
  /** argo's request id for the approval: the commission's idempotency key, and how a repeat is told from another approval. */
  readonly requestId: string;
  readonly requestHash: string;
  readonly approvedAt: Date;
}
