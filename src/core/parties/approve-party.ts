import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore } from '../connection/ports.js';
import type { RequestHasher } from '../installation/ports.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { McpServerCredential } from '../vault/credential.js';
import type { McpClientParty, McpServerParty, Party } from './party.js';
import type { PartyStore, ProxyShipDoor } from './ports.js';
import { shownPartyOf, type ShownParty } from './shown-party.js';

/** The type of every outside MCP server's proxy ship. */
export const MCP_SERVER_SHIP_TYPE = 'mcp-server';

/** The type of every outside MCP client's proxy ship. */
export const MCP_CLIENT_SHIP_TYPE = 'mcp-client';

export type ApprovePartyRefusal = DomainError<'NOT_CONNECTED' | 'PARTY_EXISTS' | 'COMMISSION_REFUSED' | 'FLEET_UNAVAILABLE'>;

export type ApproveParty = (input: {
  operatorFleetId: FleetId;
  requestId: string;
  name: string;
  url: string;
  credential: McpServerCredential;
  ownerShipId: ShipId;
  /** The scopes granted its proxy ship beside the ones every app ship gets (decision 0046). */
  scopes: readonly string[];
  concurrencyLimit: number;
}) => Promise<Result<ShownParty, ApprovePartyRefusal>>;

export type ApproveClientParty = (input: {
  operatorFleetId: FleetId;
  requestId: string;
  name: string;
  clientId: string;
  ownerShipId: ShipId;
  scopes: readonly string[];
}) => Promise<Result<ShownParty, ApprovePartyRefusal | DomainError<'CLIENT_HAS_PARTY'>>>;

interface ApprovalDeps { connections: ConnectionStore; parties: PartyStore; door: ProxyShipDoor; hasher: RequestHasher; clock: Clock }

/** What one approval asks for: the party it keeps, as it is before its proxy ship is commissioned, under its request's hash. */
interface Approval<P extends Party> {
  fleetId: FleetId;
  type: string;
  scopes: readonly string[];
  requestHash: string;
  party: (fields: { approvedAt: Date }) => P;
  /** Whether a party kept under the name is this approval's own kind, so a repeat finds it. */
  isOwn: (earlier: Party) => earlier is P;
}

/**
 * The approval flow every party shares (interop I-5). The gateway, as its
 * own ship, commissions the party's app proxy ship owned by the owner argo
 * picked (decisions 0044, 0045), under argo's request id as the idempotency
 * key, then crews it with its secret and keeps the crew token. Each step is
 * kept before the next, so the same approval again picks up where a crash or
 * a fleet that did not answer left it, and commissions no second ship. A
 * commission the fleet stored but whose answer was lost leaves the ship
 * awaiting crew: its secret was shown once. A refused commission keeps
 * nothing, so argo may approve again.
 */
async function approved<P extends Party>(deps: ApprovalDeps, approval: Approval<P>): Promise<Result<ShownParty, ApprovePartyRefusal>> {
  const crewed = async (party: P & { proxyShipId: ShipId; secret: string }): Promise<Result<ShownParty, ApprovePartyRefusal>> => {
    const registered = await deps.door.register({ shipId: party.proxyShipId, secret: party.secret });
    if (!registered.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not let the gateway crew the proxy ship: ${registered.error.message}`);
    }
    const done: P = { ...party, state: 'crewed', secret: null, crewToken: registered.value.crewToken };
    await deps.parties.save(done);
    return ok(shownPartyOf(done));
  };

  const { fleetId } = approval;
  const gateway = await deps.connections.find(fleetId);
  if (!gateway) {
    return refuse('NOT_CONNECTED', 'The gateway is not connected to this fleet: connect it in the console');
  }
  const fresh = approval.party({ approvedAt: deps.clock.now() });
  const earlier = await deps.parties.find(fleetId, fresh.name);
  if (earlier && (!approval.isOwn(earlier) || earlier.requestHash !== approval.requestHash)) {
    return refuse('PARTY_EXISTS', `A party named ${fresh.name} was approved already`);
  }
  const party: P = earlier ?? fresh;
  if (party.state === 'crewed') {
    return ok(shownPartyOf(party));
  }
  if (party.proxyShipId !== null && party.secret !== null) {
    return crewed({ ...party, proxyShipId: party.proxyShipId, secret: party.secret });
  }
  if (party.proxyShipId !== null) {
    return ok(shownPartyOf(party));
  }
  await deps.parties.save(party);

  const commissioned = await deps.door.commissionAppShip(gateway.crewToken, { name: party.name, type: approval.type, owner: party.ownerShipId, idempotencyKey: party.requestId, scopes: approval.scopes });
  if (!commissioned.isOk) {
    if (commissioned.error.code === 'UNAVAILABLE') {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not answer the commission: ${commissioned.error.message}`);
    }
    await deps.parties.remove(fleetId, party.name);
    return refuse('COMMISSION_REFUSED', `The fleet refused the proxy ship: ${commissioned.error.message}`);
  }
  const { shipId, secret } = commissioned.value;
  const awaiting: P = { ...party, state: 'awaitingCrew', proxyShipId: shipId, secret };
  await deps.parties.save(awaiting);
  return secret === null ? ok(shownPartyOf(awaiting)) : crewed({ ...awaiting, proxyShipId: shipId, secret });
}

/** What a party is before its proxy ship is commissioned. */
const UNCOMMISSIONED = { state: 'commissioning', proxyShipId: null, secret: null, crewToken: null } as const;

/**
 * Use case: argo approves an outside MCP server as a party of its fleet: the
 * gateway commissions and crews its proxy ship, and keeps the server's
 * credential in its vault.
 */
export function createApproveParty(deps: ApprovalDeps): ApproveParty {
  return (input) => {
    const { operatorFleetId: fleetId, requestId, name, url, credential, ownerShipId, scopes, concurrencyLimit } = input;
    const requestHash = deps.hasher.hash(JSON.stringify([requestId, name, url, credential, ownerShipId, scopes, concurrencyLimit]));
    return approved<McpServerParty>(deps, {
      fleetId,
      type: MCP_SERVER_SHIP_TYPE,
      scopes,
      requestHash,
      party: ({ approvedAt }) => ({ fleetId, name, kind: 'mcpServer', url, credential, ownerShipId, concurrencyLimit, ...UNCOMMISSIONED, requestId, requestHash, approvedAt }),
      isOwn: (earlier): earlier is McpServerParty => earlier.kind === 'mcpServer',
    });
  };
}

/**
 * Use case: argo approves an outside MCP client as a party, at its first
 * authorization: the gateway commissions and crews its proxy ship, which
 * the client then calls the fleet as. One party per client in a fleet.
 */
export function createApproveClientParty(deps: ApprovalDeps): ApproveClientParty {
  return async (input) => {
    const { operatorFleetId: fleetId, requestId, name, clientId, ownerShipId, scopes } = input;
    const held = await deps.parties.findByClient(fleetId, clientId);
    if (held && held.name !== name) {
      return refuse('CLIENT_HAS_PARTY', `This client is the party ${held.name} already`);
    }
    const requestHash = deps.hasher.hash(JSON.stringify([requestId, name, clientId, ownerShipId, scopes]));
    return approved<McpClientParty>(deps, {
      fleetId,
      type: MCP_CLIENT_SHIP_TYPE,
      scopes,
      requestHash,
      party: ({ approvedAt }) => ({ fleetId, name, kind: 'mcpClient', clientId, ownerShipId, ...UNCOMMISSIONED, requestId, requestHash, approvedAt }),
      isOwn: (earlier): earlier is McpClientParty => earlier.kind === 'mcpClient',
    });
  };
}
