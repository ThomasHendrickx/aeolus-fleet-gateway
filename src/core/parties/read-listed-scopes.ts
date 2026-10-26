import type { Actor } from '../actors/authenticate-actor.js';
import type { ConnectionStore, FleetDoor, ListedScope } from '../connection/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { APPROVING_SCOPE } from './approver.js';

export type ReadListedScopes = (input: { actor: Actor }) => Promise<Result<ListedScope[], DomainError<'NOT_AN_APPROVER' | 'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

/**
 * Use case: the scopes an approver may require of a calling ship (gateway
 * scopes 4.3), every one the fleet lists now with its description, read as
 * the gateway's ship as the change itself checks them. Only an approver
 * picks them, so only an approver reads them.
 */
export function createReadListedScopes(deps: { connections: Pick<ConnectionStore, 'find'>; door: Pick<FleetDoor, 'listScopes'> }): ReadListedScopes {
  return async ({ actor }) => {
    if (!actor.scopes.includes(APPROVING_SCOPE)) {
      return refuse('NOT_AN_APPROVER', `Reading the scopes to require takes ${APPROVING_SCOPE}`);
    }
    const gateway = await deps.connections.find(actor.fleetId);
    if (gateway === undefined) {
      return refuse('NOT_CONNECTED', 'The gateway is not connected to the fleet');
    }
    const listed = await deps.door.listScopes(gateway.crewToken);
    return listed.isOk ? ok(listed.value) : refuse('FLEET_UNAVAILABLE', `The fleet did not say which scopes it lists: ${listed.error.message}`);
  };
}
