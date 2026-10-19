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
 * What every party has: one app proxy ship (decision 0044), owned by the
 * person inside who answers for it (0045), crewed by the gateway. Known by
 * its ship's name, unique in the fleet.
 */
interface PartyBase {
  readonly fleetId: FleetId;
  readonly name: string;
  /** The owner argo picked: a person's ship, or argo. */
  readonly ownerShipId: ShipId;
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

/** An outside MCP server argo approved for its fleet: fleet ships call its tools through its proxy ship (MCP out). */
export interface McpServerParty extends PartyBase {
  readonly kind: 'mcpServer';
  /** The server's Streamable HTTP endpoint. */
  readonly url: string;
  readonly credential: McpServerCredential;
  /** The most calls the gateway has in flight to the server at once. */
  readonly concurrencyLimit: number;
}

/** An outside MCP client argo approved at /authorize: it calls fleet ships as its proxy ship (MCP in). */
export interface McpClientParty extends PartyBase {
  readonly kind: 'mcpClient';
  /** Its OAuth client id: pre-registered, or its metadata document's URL. */
  readonly clientId: string;
}

/**
 * A person who signs in through the gateway (interop 3.2: kind person): argo
 * maps them by their email to their own ship, which argo commissioned, and
 * the gateway crews it for them, so their chat holds no crew token (0.8).
 * Their first sign-in with that verified email binds the provider's issuer
 * and subject (Q26); later sign-ins match the subject only.
 */
export interface PersonParty extends PartyBase {
  readonly kind: 'person';
  /** Lower case, as a sign-in's verified email is matched to it. */
  readonly email: string;
  readonly issuer: string | null;
  readonly subject: string | null;
}

export type Party = McpServerParty | McpClientParty | PersonParty;
