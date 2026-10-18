import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore } from '../connection/ports.js';
import type { RequestHasher } from '../installation/ports.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { McpServerCredential } from '../vault/credential.js';
import type { McpServerParty } from './party.js';
import { shownPartyOf, type ShownParty } from './shown-party.js';
import type { PartyStore, ProxyShipDoor } from './ports.js';

/** The type of every outside MCP server's proxy ship. */
export const MCP_SERVER_SHIP_TYPE = 'mcp-server';

export type ApprovePartyRefusal = DomainError<'NOT_CONNECTED' | 'PARTY_EXISTS' | 'COMMISSION_REFUSED' | 'FLEET_UNAVAILABLE'>;

export type ApproveParty = (input: {
  operatorFleetId: FleetId;
  requestId: string;
  name: string;
  url: string;
  credential: McpServerCredential;
  ownerShipId: ShipId;
  concurrencyLimit: number;
}) => Promise<Result<ShownParty, ApprovePartyRefusal>>;

/**
 * Use case: argo approves an outside MCP server as a party of its fleet
 * (interop I-5). The gateway, as its own ship, commissions the party's app
 * proxy ship owned by the owner argo picked (decisions 0044, 0045), under
 * argo's request id as the idempotency key, then crews it with its secret
 * and keeps the crew token and the server's credential. Each step is kept
 * before the next, so the same approval again picks up where a crash or a
 * fleet that did not answer left it, and commissions no second ship. A
 * commission the fleet stored but whose answer was lost leaves the ship
 * awaiting crew: its secret was shown once. A refused commission keeps
 * nothing, so argo may approve again.
 */
export function createApproveParty(deps: { connections: ConnectionStore; parties: PartyStore; door: ProxyShipDoor; hasher: RequestHasher; clock: Clock }): ApproveParty {
  /** Crews the party's commissioned proxy ship with the secret kept for it. */
  const crewed = async (party: McpServerParty & { proxyShipId: ShipId; secret: string }): Promise<Result<ShownParty, ApprovePartyRefusal>> => {
    const registered = await deps.door.register({ shipId: party.proxyShipId, secret: party.secret });
    if (!registered.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not let the gateway crew the proxy ship: ${registered.error.message}`);
    }
    const done: McpServerParty = { ...party, state: 'crewed', secret: null, crewToken: registered.value.crewToken };
    await deps.parties.save(done);
    return ok(shownPartyOf(done));
  };

  return async (input) => {
    const { operatorFleetId: fleetId, requestId, name } = input;
    const gateway = await deps.connections.find(fleetId);
    if (!gateway) {
      return refuse('NOT_CONNECTED', 'The gateway is not connected to this fleet: connect it in the console');
    }
    const requestHash = deps.hasher.hash(JSON.stringify([requestId, name, input.url, input.credential, input.ownerShipId, input.concurrencyLimit]));
    const earlier = await deps.parties.find(fleetId, name);
    if (earlier && (earlier.kind !== 'mcpServer' || earlier.requestHash !== requestHash)) {
      return refuse('PARTY_EXISTS', `A party named ${name} was approved already`);
    }
    const party: McpServerParty = earlier ?? {
      fleetId,
      name,
      kind: 'mcpServer',
      url: input.url,
      credential: input.credential,
      ownerShipId: input.ownerShipId,
      concurrencyLimit: input.concurrencyLimit,
      state: 'commissioning',
      proxyShipId: null,
      secret: null,
      crewToken: null,
      requestId,
      requestHash,
      approvedAt: deps.clock.now(),
    };
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

    const commissioned = await deps.door.commissionAppShip(gateway.crewToken, { name, type: MCP_SERVER_SHIP_TYPE, owner: input.ownerShipId, idempotencyKey: requestId });
    if (!commissioned.isOk) {
      if (commissioned.error.code === 'UNAVAILABLE') {
        return refuse('FLEET_UNAVAILABLE', `The fleet did not answer the commission: ${commissioned.error.message}`);
      }
      await deps.parties.remove(fleetId, name);
      return refuse('COMMISSION_REFUSED', `The fleet refused the proxy ship: ${commissioned.error.message}`);
    }
    const { shipId, secret } = commissioned.value;
    const awaiting: McpServerParty = { ...party, state: 'awaitingCrew', proxyShipId: shipId, secret };
    await deps.parties.save(awaiting);
    return secret === null ? ok(shownPartyOf(awaiting)) : crewed({ ...awaiting, proxyShipId: shipId, secret });
  };
}
