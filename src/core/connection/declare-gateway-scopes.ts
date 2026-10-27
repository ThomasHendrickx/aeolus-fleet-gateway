import type { FleetId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { DECLARED_SCOPES, GATEWAY_NAMESPACE } from './connect.js';
import type { ConnectionStore, FleetDoor } from './ports.js';

export type DeclareGatewayScopes = (fleetId: FleetId) => Promise<Result<undefined, DomainError<'NOT_CONNECTED' | 'SCOPE_REFUSED'>>>;

/**
 * Use case: the gateway declares its whole namespace again in a fleet it is
 * connected to, as it starts, so a scope added since that fleet connected
 * (gateway:slack) is offered there too. A refusal keeps the connection: the
 * fleet keeps the list it took before.
 */
export function createDeclareGatewayScopes(deps: { door: Pick<FleetDoor, 'declareScopes'>; store: Pick<ConnectionStore, 'find'> }): DeclareGatewayScopes {
  return async (fleetId) => {
    const crew = await deps.store.find(fleetId);
    if (crew === undefined) {
      return refuse('NOT_CONNECTED', 'The gateway is not connected to this fleet');
    }
    const declared = await deps.door.declareScopes(crew.crewToken, GATEWAY_NAMESPACE);
    if (!declared.isOk) {
      return refuse('SCOPE_REFUSED', `The fleet did not take the gateway's scopes ${DECLARED_SCOPES}: ${declared.error.message}`);
    }
    return ok(undefined);
  };
}
