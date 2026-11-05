import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential, CredentialOf } from '../actors/credential-of.js';
import type { FleetRefusal } from '../connection/ports.js';
import { refuse } from '../shared/errors.js';
import { err, ok } from '../shared/result.js';
import type { ActiveShips } from './ports.js';
import { createReadYourFleet } from './read-your-fleet.js';
import type { ListedShip } from './your-fleet.js';

// A person reads Your fleet as their account (fleet:read): the fleet decides
// which ships they read, and the gateway adds no reach of its own.

const ACCOUNT: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc_01m3tbfspe96yf1rnr4ank9tho', personShipId: null, accountToken: 'aeolus_at_v1_thomas', scopes: ['fleet:read'] };
const SENT: ActorCredential = {};
const AS_ACCOUNT: ActorCredential = { crewToken: 'aeolus_ct_v1_gateway', accountToken: 'aeolus_at_v1_thomas' };
const credentialOf: CredentialOf = () => Promise.resolve(ok(AS_ACCOUNT));

const REVIEWER: ListedShip = { shipId: 'shp_01m3tbfspe96yf1rnr4ank9rev', name: 'reviewer', kind: 'agent', state: 'working', note: 'reviewing #165', lastActivityAt: '2026-11-01T12:00:00.000Z' };

/** The fleet's ships, as each credential reads them. */
function activeShips(answer: { readonly ships: readonly ListedShip[] } | FleetRefusal): ActiveShips & { readAs: ActorCredential[] } {
  const readAs: ActorCredential[] = [];
  return {
    readAs,
    alertCount: () => Promise.resolve(ok(0)),
    list: (as) => {
      readAs.push(as);
      return Promise.resolve('ships' in answer ? ok([...answer.ships]) : err(answer));
    },
  };
}

describe('a person reads Your fleet', () => {
  it('as their account, so the fleet decides which ships they read', async () => {
    const ships = activeShips({ ships: [REVIEWER] });

    await createReadYourFleet({ ships, credentialOf })({ actor: ACCOUNT, as: SENT });

    expect(ships.readAs).toEqual([AS_ACCOUNT]);
  });

  it('answers the ships it reads in their states and groups', async () => {
    const read = await createReadYourFleet({ ships: activeShips({ ships: [REVIEWER] }), credentialOf })({ actor: ACCOUNT, as: SENT });

    expect(read).toEqual(
      ok({
        shipCount: 1,
        counts: { alert: 0, awaitingCrew: 0, blocked: 0, working: 1, idle: 0 },
        groups: [{ group: 'agents', tiles: [{ shipId: 'shp_01m3tbfspe96yf1rnr4ank9rev', name: 'reviewer', state: 'working', note: 'reviewing #165', lastActivityAt: '2026-11-01T12:00:00.000Z' }] }],
      }),
    );
  });

  it('is refused when their account may not read the fleet', async () => {
    const read = await createReadYourFleet({ ships: activeShips({ code: 'FORBIDDEN', message: 'fleet.list needs the fleet:read scope' }), credentialOf })({ actor: ACCOUNT, as: SENT });

    expect(read).toEqual(refuse('SCOPE_NOT_HELD', 'fleet.list needs the fleet:read scope'));
  });

  it('says why when the fleet does not answer', async () => {
    const read = await createReadYourFleet({ ships: activeShips({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }), credentialOf })({ actor: ACCOUNT, as: SENT });

    expect(read).toEqual(refuse('FLEET_UNAVAILABLE', 'The fleet did not list its ships: The fleet did not answer'));
  });

  it('says why when the gateway is not connected to their fleet', async () => {
    const notConnected: CredentialOf = () => Promise.resolve(refuse('FLEET_UNAVAILABLE', 'The gateway is not connected to your fleet'));

    const read = await createReadYourFleet({ ships: activeShips({ ships: [REVIEWER] }), credentialOf: notConnected })({ actor: ACCOUNT, as: SENT });

    expect(read).toEqual(refuse('FLEET_UNAVAILABLE', 'The gateway is not connected to your fleet'));
  });
});
