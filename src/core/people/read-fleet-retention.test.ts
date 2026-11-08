import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential, CredentialOf } from '../actors/credential-of.js';
import type { FleetRefusal } from '../connection/ports.js';
import { refuse } from '../shared/errors.js';
import { err, ok } from '../shared/result.js';
import type { FleetRetention, Retention } from './ports.js';
import { createReadFleetRetention } from './read-fleet-retention.js';

// A client showing an exchange tells, at the end of its history, whether it
// began there or the fleet no longer keeps earlier messages (decision 0066).

const ACCOUNT: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc_01m3tbfspe96yf1rnr4ank9tho', personShipId: null, accountToken: 'aeolus_at_v1_thomas', scopes: ['fleet:read'] };
const AS_ACCOUNT: ActorCredential = { crewToken: 'aeolus_ct_v1_gateway', accountToken: 'aeolus_at_v1_thomas' };
const credentialOf: CredentialOf = () => Promise.resolve(ok(AS_ACCOUNT));

function fleetRetention(answer: Retention | FleetRefusal): FleetRetention & { read: ActorCredential[] } {
  const read: ActorCredential[] = [];
  return {
    read,
    retention: (as) => {
      read.push(as);
      return Promise.resolve('days' in answer ? ok(answer) : err(answer));
    },
  };
}

describe("a person reads the fleet's retention", () => {
  it('as their account, with the days and from when messages are kept', async () => {
    const retention = fleetRetention({ days: 90, keptFrom: '2026-08-10T00:00:00.000Z' });

    const read = await createReadFleetRetention({ retention, credentialOf })({ actor: ACCOUNT, as: {} });

    expect(read).toEqual(ok({ days: 90, keptFrom: '2026-08-10T00:00:00.000Z' }));
    expect(retention.read).toEqual([AS_ACCOUNT]);
  });

  it('answers null for no retention and for nothing pruned yet', async () => {
    const read = await createReadFleetRetention({ retention: fleetRetention({ days: null, keptFrom: null }), credentialOf })({ actor: ACCOUNT, as: {} });

    expect(read).toEqual(ok({ days: null, keptFrom: null }));
  });

  it('says the scope is not held when the fleet refuses the read', async () => {
    const read = await createReadFleetRetention({ retention: fleetRetention({ code: 'FORBIDDEN', message: 'no scope' }), credentialOf })({ actor: ACCOUNT, as: {} });

    expect(read).toEqual(refuse('SCOPE_NOT_HELD', 'no scope'));
  });

  it('says the fleet is unavailable when it does not answer', async () => {
    const read = await createReadFleetRetention({ retention: fleetRetention({ code: 'UNAVAILABLE', message: 'down' }), credentialOf })({ actor: ACCOUNT, as: {} });

    expect(read).toEqual(refuse('FLEET_UNAVAILABLE', "The fleet did not answer its retention: down"));
  });
});
