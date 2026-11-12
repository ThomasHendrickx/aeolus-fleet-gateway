import { idSchema } from '@aeolus-fleet/common';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../test/support/fleet-fakes.js';
import type { PersonCrew, PersonCrews, WaiterLocks } from './core/people/ports.js';
import { createPersonWaiters } from './person-waiters.js';

// A crew token is a secret: no log line of a waiter may carry it, however the
// ship that woke the waiter was given (the crew just saved holds the token).

const SHIP_ID = idSchema('ship').parse('shp_01m3tb1zgr5h2ffee12xnch9a0');
const CREW_TOKEN = 'aeolus_ct_v1_secret-of-a-person-ship';

const noCrews: PersonCrews = {
  crewed: () => Promise.resolve([]),
  find: () => Promise.resolve(undefined),
  save: () => Promise.resolve(),
  drop: () => Promise.resolve(),
};
const freeLocks: WaiterLocks = { take: () => Promise.resolve(true), give: () => Promise.resolve(), onLost: () => undefined };

describe("a person ship's waiter", () => {
  it.each([
    { ended: 'crewEnded' as const, line: 'the crew was dropped' },
    { ended: 'boom' as const, line: 'the waiter failed' },
  ])('logs no crew token when $line', async ({ ended }) => {
    const lines: string[] = [];
    const log = Fastify({ logger: { level: 'info', stream: { write: (line: string) => { lines.push(line); } } } }).log;
    const lockGiven = Promise.withResolvers<undefined>();
    const waiters = createPersonWaiters({
      crews: noCrews,
      isServed: () => Promise.resolve(true),
      locks: { ...freeLocks, give: () => { lockGiven.resolve(undefined); return Promise.resolve(); } },
      waitOnPersonShip: () => (ended === 'boom' ? Promise.reject(new Error('the fleet did not answer')) : Promise.resolve({ reason: 'crewEnded' as const })),
      sleep: () => Promise.resolve(),
      roundMs: 60_000,
      log,
    });

    // What the save of a crew hands over: the whole crew, token included.
    const crew: PersonCrew = { fleetId: FLEET_ID, shipId: SHIP_ID, crewToken: CREW_TOKEN, crewedAt: new Date() };
    waiters.wake(crew);
    await lockGiven.promise;
    await waiters.stop();

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('')).not.toContain(CREW_TOKEN);
  });
});

describe('the waiters of the person ships the gateway crews', () => {
  it('start no waiter for a ship of a fleet the gateway does not serve, and start it once the fleet is served again', async () => {
    const fleetSwitch = { isOn: false };
    const crew: PersonCrew = { fleetId: FLEET_ID, shipId: SHIP_ID, crewToken: CREW_TOKEN, crewedAt: new Date() };
    const started: string[] = [];
    let rounds = 0;
    const roundDone = { next: Promise.withResolvers<undefined>() };
    const waiters = createPersonWaiters({
      crews: { ...noCrews, crewed: ({ after }) => Promise.resolve(after === null ? [crew] : []) },
      isServed: () => Promise.resolve(fleetSwitch.isOn),
      locks: freeLocks,
      waitOnPersonShip: (ship, signal) => {
        started.push(ship.shipId);
        return new Promise((ended) => { signal.addEventListener('abort', () => { ended({ reason: 'stopped' }); }); });
      },
      sleep: () => {
        rounds += 1;
        roundDone.next.resolve(undefined);
        roundDone.next = Promise.withResolvers<undefined>();
        return new Promise((resolve) => setTimeout(resolve, 5));
      },
      roundMs: 5,
      log: Fastify({ logger: false }).log,
    });

    waiters.start();
    waiters.wake(crew);
    await roundDone.next.promise;
    await roundDone.next.promise;
    const whileOff = [...started];
    fleetSwitch.isOn = true;
    await roundDone.next.promise;
    await roundDone.next.promise;
    await waiters.stop();

    expect({ whileOff, once: started, roundsRan: rounds > 2 }).toEqual({ whileOff: [], once: [SHIP_ID], roundsRan: true });
  });
});
