import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor } from '../connection/ports.js';
import { lackingScopesMessage, scopesLacking } from './scope-requirements.js';

/**
 * How checking a call's scopes ended:
 * - holds: the calling ship holds every needed scope, so the call goes on;
 * - lacks: it does not, and the message names what is missing (P2);
 * - unread: core did not answer the read, so the call waits and is tried again, never made unchecked.
 */
export type ScopeCheck = { readonly kind: 'holds' } | { readonly kind: 'lacks'; readonly message: string } | { readonly kind: 'unread' };

export type CheckRequiredScopes = (call: { fleetId: FleetId; senderShipId: ShipId; needing: string; needed: readonly string[] }) => Promise<ScopeCheck>;

/**
 * Use case: whether the ship calling an outside party holds every scope the
 * call needs (design gateway-scopes, 4.2). The gateway reads the ship's
 * scopes from core as its own ship, on the calling ship's behalf so its read
 * reach holds it, on every call and never from the message (decision 0057):
 * a scope revoked holds at the next call (0046). A call that needs nothing
 * reads nothing.
 */
export function createCheckRequiredScopes(deps: { connections: Pick<ConnectionStore, 'find'>; door: Pick<FleetDoor, 'getShip'> }): CheckRequiredScopes {
  return async ({ fleetId, senderShipId, needing, needed }) => {
    if (needed.length === 0) {
      return { kind: 'holds' };
    }
    const gateway = await deps.connections.find(fleetId);
    if (gateway === undefined) {
      return { kind: 'unread' };
    }
    const ship = await deps.door.getShip(gateway.crewToken, { shipId: senderShipId, onBehalfOf: senderShipId });
    if (!ship.isOk) {
      return { kind: 'unread' };
    }
    const lacking = scopesLacking(needed, ship.value.scopes);
    return lacking.length === 0 ? { kind: 'holds' } : { kind: 'lacks', message: lackingScopesMessage({ needing, lacking, shipName: ship.value.name }) };
  };
}
