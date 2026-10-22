import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential, CredentialOf } from '../actors/credential-of.js';
import { err, ok } from '../shared/result.js';
import { createListOwnerChoices } from './list-owner-choices.js';
import type { FleetShip, FleetShips } from './ports.js';

// A party's owner is picked from the ships the fleet takes as an owner: an
// active person's ship or argo (decision 0045), as the actor reads the fleet.

const SHIP: Actor = { fleetId: FLEET_ID, kind: 'ship', shipId: 'shp_01m3tbfspe96yf1rnr4ank9agt', scopes: ['fleet:read'] };
const CREDENTIAL: ActorCredential = { crewToken: 'aeolus_ct_v1_agent' };
const credentialOf: CredentialOf = (_actor, sent) => Promise.resolve(ok(sent));

function aShip(overrides: Partial<FleetShip>): FleetShip {
  return { shipId: 'shp_01m3tbfspe96yf1rnr4ank9chr', name: 'charlotte', kind: 'person', status: 'crewed', ...overrides };
}

function ships(listed: FleetShip[] | 'unavailable'): FleetShips {
  return { list: () => Promise.resolve(listed === 'unavailable' ? err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }) : ok(listed)) };
}

describe('an actor picks the owner of a party', () => {
  it("from the fleet's person ships and argo that are not retired, by name", async () => {
    const listed = ships([
      aShip({ shipId: 'shp_01m3tbfspe96yf1rnr4ank9arg', name: 'argo', kind: 'operator' }),
      aShip({ shipId: 'shp_01m3tbfspe96yf1rnr4ank9chr', name: 'charlotte', status: 'awaitingCrew' }),
      aShip({ shipId: 'shp_01m3tbfspe96yf1rnr4ank9old', name: 'gone', status: 'retired' }),
      aShip({ shipId: 'shp_01m3tbfspe96yf1rnr4ank9agt', name: 'agent', kind: 'agent' }),
      aShip({ shipId: 'shp_01m3tbfspe96yf1rnr4ank9app', name: 'gateway', kind: 'app' }),
    ]);

    await expect(createListOwnerChoices({ ships: listed, credentialOf })({ actor: SHIP, as: CREDENTIAL })).resolves.toEqual(
      ok([
        { shipId: 'shp_01m3tbfspe96yf1rnr4ank9arg', name: 'argo' },
        { shipId: 'shp_01m3tbfspe96yf1rnr4ank9chr', name: 'charlotte' },
      ]),
    );
  });

  it('is told when the fleet does not list its ships', async () => {
    await expect(createListOwnerChoices({ ships: ships('unavailable'), credentialOf })({ actor: SHIP, as: CREDENTIAL })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});
