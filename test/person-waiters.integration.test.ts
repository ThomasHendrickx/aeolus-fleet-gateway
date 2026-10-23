import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaPersonCrews } from '../src/adapters/prisma/person-crews.js';
import { createPostgresWaiterLocks } from '../src/adapters/prisma/waiter-locks.js';
import { sleep } from '../src/adapters/timers/sleep.js';
import type { InboxChange, PersonShip } from '../src/core/people/ports.js';
import { createWaitOnPersonShip } from '../src/core/people/wait-on-person-ship.js';
import { createPersonWaiters, type PersonWaiters } from '../src/person-waiters.js';
import { commission, register, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';

// The gateway waits on every person ship it crews, one waiter per ship
// across its instances (wake a person, W7, W9): each instance takes a ship's
// waiter only while it holds the ship's advisory lock in the gateway's
// database, so a second instance waits on none, and takes the waiters of an
// instance that stopped. Against a real core and a real Postgres.

const ROUND_MS = 100;
const SETTLED_MS = 1000;

let fleet: FleetServer;
let databaseUrl: string;
let prisma: PrismaClient;
let charlotte: PersonShip;
let charlotteCrew: string;
let tracker: string;
/** The inbox changes told, by every instance, as they were told. */
let told: InboxChange[];
let instances: PersonWaiters[];
let closings: (() => Promise<void>)[];

beforeAll(async () => {
  databaseUrl = await migratedDatabase(inject('postgresUrl'));
  prisma = createPrismaClient(databaseUrl);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  const cookie = await signIn(fleet);
  charlotteCrew = await register(fleet, await commission(fleet, { cookie, ship: { name: 'charlotte', type: 'person', kind: 'person' } }));
  tracker = await register(fleet, await commission(fleet, { cookie, ship: { name: 'tracker', type: 'issue-tracker', kind: 'app' } }));
  const who = await createRestFleetDoor(fleet.url).whoami(charlotteCrew);
  if (!who.isOk) {
    throw new Error('charlotte is not crewed');
  }
  charlotte = { fleetId: who.value.fleetId, shipId: who.value.shipId };
  await prisma.personCrew.deleteMany({});
  await createPrismaPersonCrews(prisma).save({ ...charlotte, crewToken: charlotteCrew, crewedAt: new Date() });
  told = [];
  instances = [];
  closings = [];
});

afterEach(async () => {
  await Promise.all(instances.map((instance) => instance.stop()));
  await Promise.all(closings.map((close) => close()));
  await fleet.stop();
});

/** One gateway instance's waiters, over the shared gateway database and the fleet. */
function anInstance(options: { roundMs?: number } = {}): PersonWaiters {
  const crews = createPrismaPersonCrews(prisma);
  const locks = createPostgresWaiterLocks(databaseUrl);
  const waiters = createPersonWaiters({
    crews,
    locks,
    waitOnPersonShip: createWaitOnPersonShip({
      crews,
      door: createRestFleetDoor(fleet.url).person,
      changes: {
        tell: (change) => {
          told.push(change);
          return Promise.resolve();
        },
      },
      sleep,
      againWaitsMs: [ROUND_MS],
      // No channel is on: these tests hear the pages alone.
      wake: () => Promise.resolve({ kind: 'settled' }),
      clock: { now: () => new Date() },
      wakeAgainWaitsMs: [ROUND_MS],
    }),
    sleep,
    roundMs: options.roundMs ?? ROUND_MS,
    log: Fastify({ logger: false }).log,
  });
  instances.push(waiters);
  closings.push(() => locks.close());
  return waiters;
}

async function trackerSendsCharlotte(): Promise<void> {
  const sent = await fetch(`${fleet.url}/api/v1/ship/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tracker}` },
    body: JSON.stringify({ selector: { kind: 'ship', name: 'charlotte' }, contentType: 'text/plain', payload: 'Issue 7 is closed', idempotencyKey: crypto.randomUUID() }),
  });
  expect(sent.status).toBe(200);
}

describe('the waiters of the person ships the gateway crews', () => {
  it('start for every crew held once the gateway starts, as after a restart', async () => {
    const instance = anInstance();

    instance.start();

    await expect.poll(() => instance.waitingOn()).toEqual([charlotte]);
  });

  it("tell the person's pages once a delivery reaches their person ship", async () => {
    const instance = anInstance();
    instance.start();
    await expect.poll(() => instance.waitingOn()).toEqual([charlotte]);
    // The waiter's first look, which tells too, comes before the delivery.
    await expect.poll(() => told).toEqual([charlotte]);
    await new Promise((resolve) => setTimeout(resolve, SETTLED_MS));
    told = [];

    await trackerSendsCharlotte();

    await expect.poll(() => told, { timeout: 10_000 }).toEqual([charlotte]);
  });

  it('are one per ship across two instances', async () => {
    const first = anInstance();
    const second = anInstance();

    first.start();
    second.start();
    await expect.poll(() => first.waitingOn().length + second.waitingOn().length).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, SETTLED_MS));

    expect(first.waitingOn().length + second.waitingOn().length).toBe(1);
  });

  it('are taken over by the other instance once the one waiting stops', async () => {
    const first = anInstance();
    first.start();
    await expect.poll(() => first.waitingOn()).toEqual([charlotte]);
    const second = anInstance();
    second.start();
    await new Promise((resolve) => setTimeout(resolve, SETTLED_MS));
    expect(second.waitingOn()).toEqual([]);

    await first.stop();

    await expect.poll(() => second.waitingOn()).toEqual([charlotte]);
  });

  it("are taken over by the other instance once the waiting one's connection to the database ends, freeing its locks", async () => {
    // The first instance looks again only after a minute, so the second is the one to take the lock.
    const first = anInstance({ roundMs: 60_000 });
    first.start();
    await expect.poll(() => first.waitingOn()).toEqual([charlotte]);
    const second = anInstance();
    second.start();

    await prisma.$executeRaw`SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype = 'advisory' AND granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;

    await expect.poll(() => ({ first: first.waitingOn(), second: second.waitingOn() })).toEqual({ first: [], second: [charlotte] });
  });

  it('start at once for a ship the gateway crews while it runs, not at its next round', async () => {
    const instance = anInstance({ roundMs: 60_000 });
    await prisma.personCrew.deleteMany({});
    instance.start();
    await createPrismaPersonCrews(prisma).save({ ...charlotte, crewToken: charlotteCrew, crewedAt: new Date() });

    instance.wake(charlotte);

    await expect.poll(() => instance.waitingOn()).toEqual([charlotte]);
  });

  it("stop once the person ship's lease ended, dropping its crew", async () => {
    const instance = anInstance();
    instance.start();
    await expect.poll(() => instance.waitingOn()).toEqual([charlotte]);

    const ended = await fetch(`${fleet.url}/api/v1/ship/deregister`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${charlotteCrew}` }, body: '{}' });
    expect(ended.status).toBe(200);

    await expect.poll(() => instance.waitingOn(), { timeout: 30_000 }).toEqual([]);
    await expect(createPrismaPersonCrews(prisma).find(charlotte.fleetId, charlotte.shipId)).resolves.toBeUndefined();
  });
});
