import { describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential, CredentialOf } from '../actors/credential-of.js';
import type { FleetRefusal } from '../connection/ports.js';
import type { Clock } from '../shared/clock.js';
import { refuse } from '../shared/errors.js';
import { err, ok } from '../shared/result.js';
import type { FleetRetention, Retention } from './ports.js';
import { createReadFleetRetention } from './read-fleet-retention.js';

// A client showing an exchange tells, at the end of its history, whether it
// began there or the fleet no longer keeps earlier messages (decision 0066).

const ACCOUNT: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc_01m3tbfspe96yf1rnr4ank9tho', personShipId: null, accountToken: 'aeolus_at_v1_thomas', scopes: ['fleet:read'] };
const OTHER_PERSON: Actor = { ...ACCOUNT, accountId: 'acc_01m3tbfspe96yf1rnr4ank9tha', accountToken: 'aeolus_at_v1_charlotte' };
const AS_ACCOUNT: ActorCredential = { crewToken: 'aeolus_ct_v1_gateway', accountToken: 'aeolus_at_v1_thomas' };
const credentialOf: CredentialOf = () => Promise.resolve(ok(AS_ACCOUNT));
const FIVE_MINUTES_MS = 300_000;
const RETENTION: Retention = { days: 90, keptFrom: '2026-08-10T00:00:00.000Z' };

function aClock(): Clock & { pass(ms: number): void } {
  let now = new Date('2026-11-08T12:00:00.000Z');
  return {
    now: () => now,
    pass: (ms) => {
      now = new Date(now.getTime() + ms);
    },
  };
}

function fleetRetention(answer: Retention | FleetRefusal): FleetRetention & { asked: ActorCredential[] } {
  const asked: ActorCredential[] = [];
  return {
    asked,
    retention: (as) => {
      asked.push(as);
      return Promise.resolve('days' in answer ? ok(answer) : err(answer));
    },
  };
}

/** A person reading the retention: the use case with its clock, read as the actor. */
function aReader(retention: FleetRetention, clock: Clock = aClock()) {
  const read = createReadFleetRetention({ retention, credentialOf, clock });
  return (actor: Actor = ACCOUNT) => read({ actor, as: {} });
}

describe("a person reads the fleet's retention", () => {
  it('as their account, with the days and from when messages are kept', async () => {
    const retention = fleetRetention(RETENTION);

    const read = await aReader(retention)();

    expect(read).toEqual(ok({ days: 90, keptFrom: '2026-08-10T00:00:00.000Z' }));
    expect(retention.asked).toEqual([AS_ACCOUNT]);
  });

  it('answers null for no retention and for nothing pruned yet', async () => {
    const read = await aReader(fleetRetention({ days: null, keptFrom: null }))();

    expect(read).toEqual(ok({ days: null, keptFrom: null }));
  });

  it('says the scope is not held when the fleet refuses the read', async () => {
    const read = await aReader(fleetRetention({ code: 'FORBIDDEN', message: 'no scope' }))();

    expect(read).toEqual(refuse('SCOPE_NOT_HELD', 'no scope'));
  });

  it('says the fleet is unavailable when it does not answer', async () => {
    const read = await aReader(fleetRetention({ code: 'UNAVAILABLE', message: 'down' }))();

    expect(read).toEqual(refuse('FLEET_UNAVAILABLE', 'The fleet did not answer its retention: down'));
  });

  describe('shared by every person of the fleet for a few minutes, as the fleet changes it rarely', () => {
    it("makes one call to core for repeated reads of the fleet's persons", async () => {
      const retention = fleetRetention(RETENTION);
      const read = aReader(retention);

      await read();
      const again = await read(OTHER_PERSON);

      expect(again).toEqual(ok(RETENTION));
      expect(retention.asked).toEqual([AS_ACCOUNT]);
    });

    it('reads core again once five minutes have passed, and not before', async () => {
      const retention = fleetRetention(RETENTION);
      const clock = aClock();
      const read = aReader(retention, clock);
      await read();

      clock.pass(FIVE_MINUTES_MS - 1);
      await read();
      expect(retention.asked).toHaveLength(1);

      clock.pass(1);
      await read();
      expect(retention.asked).toHaveLength(2);
    });

    it("keeps one fleet's retention from another's", async () => {
      const retention = fleetRetention(RETENTION);
      const read = aReader(retention);
      await read();

      await read({ ...ACCOUNT, fleetId: OTHER_FLEET_ID });

      expect(retention.asked).toHaveLength(2);
    });

    it('does not remember a refusal', async () => {
      const retention = fleetRetention({ code: 'UNAVAILABLE', message: 'down' });
      const read = aReader(retention);
      await read();

      await read();

      expect(retention.asked).toHaveLength(2);
    });

    it('leaves the answer to core for a person who does not hold fleet:read, even after a person who does primed it', async () => {
      const asAccountOf: CredentialOf = (actor) => Promise.resolve(ok({ crewToken: 'aeolus_ct_v1_gateway', accountToken: actor.kind === 'account' ? (actor.accountToken ?? undefined) : undefined }));
      const retention: FleetRetention = {
        retention: (as) => Promise.resolve(as.accountToken === ACCOUNT.accountToken ? ok(RETENTION) : err({ code: 'FORBIDDEN', message: 'no scope' })),
      };
      const read = createReadFleetRetention({ retention, credentialOf: asAccountOf, clock: aClock() });
      await read({ actor: ACCOUNT, as: {} });

      const unscoped = await read({ actor: { ...OTHER_PERSON, scopes: [] }, as: {} });

      expect(unscoped).toEqual(refuse('SCOPE_NOT_HELD', 'no scope'));
    });
  });
});
