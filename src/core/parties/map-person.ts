import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { PersonParty } from './party.js';
import type { PartyStore, ProxyShipDoor } from './ports.js';
import { shownPartyOf, type ShownParty } from './shown-party.js';

export type MapPerson = (input: { operatorFleetId: FleetId; email: string; shipId: ShipId; secret: string }) => Promise<
  Result<ShownParty, DomainError<'PERSON_EXISTS' | 'PARTY_EXISTS' | 'SECRET_REFUSED' | 'OTHER_FLEET'>>
>;

/**
 * Use case: argo maps a person, by their email, to their own ship (Q17,
 * Q26). argo commissioned it in the console (only argo commissions person
 * ships, 0044) and hands over its secret from a new starting prompt; the
 * gateway crews the ship with it and keeps the crew token, never the secret.
 * The person is then signed in by their first sign-in with that email.
 */
export function createMapPerson(deps: { parties: PartyStore; door: ProxyShipDoor; clock: Clock }): MapPerson {
  return async ({ operatorFleetId, email, shipId, secret }) => {
    const address = email.toLowerCase();
    if (await deps.parties.findPersonByEmail(operatorFleetId, address)) {
      return refuse('PERSON_EXISTS', `argo mapped ${address} already`);
    }
    // Checked before the secret is used: a crew token the gateway would not keep could not be given back.
    if ((await deps.parties.list(operatorFleetId)).some((party) => party.proxyShipId === shipId)) {
      return refuse('PARTY_EXISTS', `The ship ${shipId} is a party already`);
    }
    const registered = await deps.door.register({ shipId, secret });
    if (!registered.isOk) {
      return refuse('SECRET_REFUSED', `The fleet refused the secret: ${registered.error.message}`);
    }
    const ship = await deps.door.whoami(registered.value.crewToken);
    if (!ship.isOk || ship.value.fleetId !== operatorFleetId) {
      return refuse('OTHER_FLEET', "The ship is not one of argo's fleet");
    }
    const person: PersonParty = {
      fleetId: operatorFleetId,
      name: ship.value.name,
      kind: 'person',
      email: address,
      issuer: null,
      subject: null,
      // A person answers for their own ship.
      ownerShipId: shipId,
      state: 'crewed',
      proxyShipId: shipId,
      secret: null,
      crewToken: registered.value.crewToken,
      // A mapping has no commission to key: one person per ship.
      requestId: shipId,
      requestHash: '',
      approvedAt: deps.clock.now(),
    };
    await deps.parties.save(person);
    return ok(shownPartyOf(person));
  };
}
