import type { FleetId, ShipId, VerifiedFact } from '@aeolus-fleet/common';

import type { McpServerCredential } from '../vault/credential.js';
import type { ToolSwitches } from './tool-switches.js';

/**
 * Where an approved party's proxy ship stands (interop I-5):
 * - commissioning: argo approved it; the gateway has not seen the fleet commission its ship yet;
 * - awaitingCrew: its ship is commissioned, and the gateway does not hold its crew token;
 * - crewed: the gateway crews its ship.
 */
export type PartyState = 'commissioning' | 'awaitingCrew' | 'crewed';

/**
 * What every party has: one app proxy ship (decision 0044), crewed by the
 * gateway. Known by its ship's name, unique in the fleet. Its owner, the
 * person inside who answers for it (0045), is the fleet's alone: the gateway
 * names it at the commission and reads it after (decision 0056).
 */
interface PartyBase {
  readonly fleetId: FleetId;
  readonly name: string;
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
  /** Which of its tools the fleet may call; none kept yet means every tool it lists (aeolus-fleet#1151). */
  readonly toolSwitches: ToolSwitches | null;
}

/** An outside MCP client argo approved at /authorize: it calls fleet ships as its proxy ship (MCP in). */
export interface McpClientParty extends PartyBase {
  readonly kind: 'mcpClient';
  /** Its OAuth client id: pre-registered, or its metadata document's URL. */
  readonly clientId: string;
}

/** An outside A2A client an approver added (decision 0060): it calls fleet ships as its proxy ship, with the bearer it was shown once (A2A in). */
export interface A2aClientParty extends PartyBase {
  readonly kind: 'a2aClient';
  /** The hash of the bearer it was shown, which names it on every call; none until one is shown. */
  readonly bearerHash: string | null;
}

export type Party = McpServerParty | McpClientParty | A2aClientParty;

/** The host of an https address, or none: only an address reached over TLS shows who answers it. */
function tlsHostOf(address: string): string | undefined {
  try {
    const url = new URL(address);
    return url.protocol === 'https:' ? url.hostname : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What the gateway checked about the party behind a proxy ship (decision
 * 0059): the host it reached an MCP server at over TLS, and the domain of the
 * metadata document it read an MCP client's id from over TLS. A client argo
 * registered has no document, and an address without TLS proves no host.
 * The gateway checks nothing about an A2A client: an approver names it.
 */
export function verifiedFactsOf(party: Party): VerifiedFact[] {
  switch (party.kind) {
    case 'mcpServer': {
      const host = tlsHostOf(party.url);
      return host === undefined ? [] : [{ checked: 'tlsHost', value: host }];
    }
    case 'mcpClient': {
      const host = tlsHostOf(party.clientId);
      return host === undefined ? [] : [{ checked: 'clientIdDocumentDomain', value: host }];
    }
    case 'a2aClient':
      return [];
  }
}
