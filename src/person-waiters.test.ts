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
