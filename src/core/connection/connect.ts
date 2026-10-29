import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { ConnectionStatus, ConnectionStore, FleetDoor } from './ports.js';

export type ConnectRefusal = DomainError<'ALREADY_CONNECTED' | 'SECRET_REFUSED' | 'OTHER_FLEET' | 'MISSING_SCOPES' | 'SCOPE_REFUSED' | 'FLEET_UNAVAILABLE'>;

export type Connect = (input: { operatorFleetId: FleetId; shipId: ShipId; secret: string }) => Promise<Result<ConnectionStatus, ConnectRefusal>>;

/**
 * What the gateway's ship does (decisions 0044 to 0046, 0059): read the
 * fleet, commission an app proxy ship for each approved outside party, naming
 * its owner, declare the gateway's own scope, and write what it checked about
 * each proxy ship.
 */
const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify'];

/**
 * The gateway's own scopes, under its namespace: approving is a scope any
 * actor may hold (decision 0056); Slack is apart from it (gateway scopes B6).
 */
export const GATEWAY_NAMESPACE = {
  namespace: 'gateway',
  scopes: [
    { scope: 'gateway:approve', description: 'Approve outside parties: outside MCP clients and servers, each acting in the fleet as its proxy ship' },
    { scope: 'gateway:slack', description: 'Connect the fleet to a Slack workspace, and expose ships within manage reach as Slack bots' },
  ],
};

export const DECLARED_SCOPES = GATEWAY_NAMESPACE.scopes.map(({ scope }) => scope).join(', ');

/**
 * Use case: argo connects the gateway, as the other plugins are connected.
 * The console's server hands it its ship's secret, server to server; the
 * gateway registers with it as a server and keeps only the crew token. The
 * ship must be of argo's fleet and hold the gateway's scopes, and the fleet
 * must take the gateway's declared scope, or the gateway lets
 * the ship go again and keeps nothing. Each fleet has its own connection:
 * connect works only while the gateway is not connected to argo's fleet,
 * whatever other fleets it serves. The secret is never kept or logged.
 */
export function createConnect(deps: { door: FleetDoor; store: ConnectionStore; clock: Clock }): Connect {
  return async ({ operatorFleetId, shipId, secret }) => {
    if (await deps.store.find(operatorFleetId)) {
      return refuse('ALREADY_CONNECTED', 'The gateway is connected to this fleet already');
    }
    const registered = await deps.door.register({ shipId, secret });
    if (!registered.isOk) {
      return refuse('SECRET_REFUSED', `The fleet refused its ship's secret: ${registered.error.message}`);
    }
    const { crewToken } = registered.value;
    const letGo = async <K extends ConnectRefusal['kind']>(kind: K, message: string) => {
      await deps.door.deregister(crewToken);
      return refuse(kind, message);
    };

    const who = await deps.door.whoami(crewToken);
    if (!who.isOk) {
      return letGo('SECRET_REFUSED', `The fleet refused the new crew token: ${who.error.message}`);
    }
    if (who.value.fleetId !== operatorFleetId) {
      return letGo('OTHER_FLEET', "The ship belongs to another fleet than the operator's");
    }
    const ship = await deps.door.getShip(crewToken, { shipId });
    if (!ship.isOk || !GATEWAY_SCOPES.every((scope) => ship.value.scopes.includes(scope))) {
      return letGo('MISSING_SCOPES', `The ship needs ${GATEWAY_SCOPES.join(', ')}`);
    }
    const declared = await deps.door.declareScopes(crewToken, GATEWAY_NAMESPACE);
    if (!declared.isOk) {
      return letGo('SCOPE_REFUSED', `The fleet did not take the gateway's scopes ${DECLARED_SCOPES}: ${declared.error.message}`);
    }

    await deps.store.save({ fleetId: who.value.fleetId, shipId, name: who.value.name, crewToken, crewedAt: deps.clock.now() });
    return ok({ state: 'connected', ship: { shipId, name: who.value.name }, lastShipId: shipId });
  };
}
