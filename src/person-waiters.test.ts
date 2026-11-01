import type { FleetId, ShipId } from '@aeolus-fleet/common';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { FLEET_ID } from '../test/support/fleet-fakes.js';
import type { PersonCrews, WaiterLocks } from './core/people/ports.js';
import { createPersonWaiters } from './person-waiters.js';

// A crew token is a secret: no log line of a waiter may carry it, however the
// ship that woke the waiter was given (the crew just saved holds the token).

const SHIP_ID = 'shp_01m3tb1zgr5h2ffee12xnch9a0' as ShipId;
const CREW_TOKEN = 'aeolus_ct_v1_secret-of-a-person-ship';

const noCrews: PersonCrews = {
  crewed: async () => [],
  find: async () => undefined,
  save: async () => undefined,
  drop: async () => undefined,
};
const freeLocks: WaiterLocks = { take: async () => true, give: async () => undefined, onLost: () => undefined };

describe("a person ship's waiter", () => {
  it.each([
    { ended: 'crewEnded' as const, line: 'the crew was dropped' },
    { ended: 'boom' as const, line: 'the waiter failed' },
  ])('logs no crew token when $line', async ({ ended }) => {
    const lines: string[] = [];
    const log = Fastify({ logger: { level: 'info', stream: { write: (line: string) => { lines.push(line); } } } }).log;
    const lockGiven = Promise.withResolvers<void>();
    const waiters = createPersonWaiters({
      crews: noCrews,
      locks: { ...freeLocks, give: async () => { lockGiven.resolve(); } },
      waitOnPersonShip: async () => {
        if (ended === 'boom') {
          throw new Error('the fleet did not answer');
        }
        return { reason: 'crewEnded' };
      },
      sleep: async () => undefined,
      roundMs: 60_000,
      log,
    });

    // What the save of a crew hands over: the whole crew, token included.
    waiters.wake({ fleetId: FLEET_ID as FleetId, shipId: SHIP_ID, crewToken: CREW_TOKEN, crewedAt: new Date() } as { fleetId: FleetId; shipId: ShipId });
    await lockGiven.promise;
    await waiters.stop();

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('')).not.toContain(CREW_TOKEN);
  });
});
