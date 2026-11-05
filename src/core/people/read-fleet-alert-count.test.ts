import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential, CredentialOf } from '../actors/credential-of.js';
import type { FleetRefusal } from '../connection/ports.js';
import { refuse } from '../shared/errors.js';
import { err, ok } from '../shared/result.js';
import type { ActiveShips } from './ports.js';
import { createReadFleetAlertCount } from './read-fleet-alert-count.js';

// The shell counts the ships with an alert on every page, so it reads one
// number the fleet counts, never the ships.

const ACCOUNT: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc_01m3tbfspe96yf1rnr4ank9tho', personShipId: null, accountToken: 'aeolus_at_v1_thomas', scopes: ['fleet:read'] };
const AS_ACCOUNT: ActorCredential = { crewToken: 'aeolus_ct_v1_gateway', accountToken: 'aeolus_at_v1_thomas' };
const credentialOf: CredentialOf = () => Promise.resolve(ok(AS_ACCOUNT));

function activeShips(answer: number | FleetRefusal): ActiveShips & { counted: ActorCredential[]; listed: number } {
  const counted: ActorCredential[] = [];
  const fake = {
    counted,
    listed: 0,
    list: () => {
      fake.listed += 1;
      return Promise.resolve(ok([]));
    },
    alertCount: (as: ActorCredential) => {
      counted.push(as);
      return Promise.resolve(typeof answer === 'number' ? ok(answer) : err(answer));
    },
  };
  return fake;
}

describe('the shell reads how many ships have an alert', () => {
  it('as their account, from the fleet\'s number, without listing a ship', async () => {
    const ships = activeShips(4);

    const read = await createReadFleetAlertCount({ ships, credentialOf })({ actor: ACCOUNT, as: {} });

    expect(read).toEqual(ok(4));
    expect(ships.counted).toEqual([AS_ACCOUNT]);
    expect(ships.listed).toBe(0);
  });

  it('says the scope is not held when the fleet refuses the read', async () => {
    const read = await createReadFleetAlertCount({ ships: activeShips({ code: 'FORBIDDEN', message: 'no scope' }), credentialOf })({ actor: ACCOUNT, as: {} });

    expect(read).toEqual(refuse('SCOPE_NOT_HELD', 'no scope'));
  });

  it('says the fleet is unavailable when it does not answer', async () => {
    const read = await createReadFleetAlertCount({ ships: activeShips({ code: 'UNAVAILABLE', message: 'down' }), credentialOf })({ actor: ACCOUNT, as: {} });

    expect(read).toEqual(refuse('FLEET_UNAVAILABLE', 'The fleet did not count its alerts: down'));
  });
});
