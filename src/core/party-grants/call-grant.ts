import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor } from '../connection/ports.js';
import type { PartyGrant } from './party-grant.js';
import type { PartyGrants } from './ports.js';

/** argo's name, which core reserves for it: an owner of this name is argo, never a person (decision 0045). */
const ARGO_NAME = 'argo';

/** A person a call is for: their person ship, by id and name. */
export interface CallPerson {
  readonly shipId: ShipId;
  readonly name: string;
}

/**
 * Whose grant a call goes out under:
 * - grant: the person who owns the asking ship holds one for the party;
 * - notSignedIn: they hold none (Q5);
 * - noPerson: argo owns the asking ship, or it is argo, so no person can sign in for it (Q10);
 * - unread: core did not answer the owner read, so the call waits and is tried again, never made without its person's grant.
 */
export type CallGrant =
  | { readonly kind: 'grant'; readonly grant: PartyGrant; readonly person: CallPerson }
  | { readonly kind: 'notSignedIn'; readonly person: CallPerson }
  | { readonly kind: 'noPerson'; readonly shipName: string }
  | { readonly kind: 'unread' };

export type CallGrantOf = (call: { fleetId: FleetId; party: string; senderShipId: ShipId }) => Promise<CallGrant>;

/**
 * The grant a call to a server where each person signs in goes out under
 * (decision 0067, Q1, Q11): the grant of the person who owns the asking
 * ship, a person ship owning itself. The owner is read from core at each
 * hand-over, as the gateway's ship on the asking ship's behalf, as the scope
 * check reads it: a change of owner holds from the next call.
 */
export function createCallGrantOf(deps: { connections: Pick<ConnectionStore, 'find'>; door: Pick<FleetDoor, 'getShip'>; grants: Pick<PartyGrants, 'ofPerson'> }): CallGrantOf {
  return async ({ fleetId, party, senderShipId }) => {
    const gateway = await deps.connections.find(fleetId);
    if (gateway === undefined) {
      return { kind: 'unread' };
    }
    const ship = await deps.door.getShip(gateway.crewToken, { shipId: senderShipId, onBehalfOf: senderShipId });
    if (!ship.isOk) {
      return { kind: 'unread' };
    }
    const { owner } = ship.value;
    if (owner === null || owner.name === ARGO_NAME) {
      return { kind: 'noPerson', shipName: ship.value.name };
    }
    const person = { shipId: owner.shipId, name: owner.name };
    const grant = await deps.grants.ofPerson(fleetId, { party, personShipId: owner.shipId });
    return grant === undefined ? { kind: 'notSignedIn', person } : { kind: 'grant', grant, person };
  };
}
