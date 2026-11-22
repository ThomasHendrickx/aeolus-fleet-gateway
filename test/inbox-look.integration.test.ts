import type { ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject } from 'vitest';

import { fleetTest as it, freshFleetTest } from './support/fleet-test.js';
import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { createPrismaClient } from '../src/adapters/prisma/client.js';
import { createHeldDeliveries, holdingDoor, type HeldDeliveries } from '../src/core/people/held-deliveries.js';
import type { PersonShipDoor } from '../src/core/people/ports.js';
import { createReadInbox, waitingFor, waitingOn, type ReadInbox } from '../src/core/people/read-inbox.js';
import { ITEM_JOBS, routingDefaultsOf } from '../src/core/people/routing.js';
import { commission, register, signIn } from './support/argo.js';
import { FLEET_ID, memoryConnectionStore } from './support/fleet-fakes.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';
import { CHARLOTTE_GRANT, fakeCrewPersonShip, memoryOpenedDeliveries, memoryPersonCrews, memoryRoutes, memoryLetGoDeliveries } from './support/people-fakes.js';
import { PERSON_SHIP_ID } from './support/sign-in-fakes.js';
import { FIXED_CLOCK } from './support/fixed-clock.js';

// A look at Charlotte's inbox, as Bridge and its workers take one, against a
// real core (aeolus-fleet #1647): with more than 10 waiting, a look is a read,
// and lists every one even while another receive holds some of them.

const WAITING = 15;
/** How many deliveries one receive takes at most, as a concurrent look takes them. */
const ONE_RECEIVE = 10;

let fleet: FleetServer;
let charlotteShipId: ShipId;
let tracker: string;
/** The person ship's calls the look made, by name. */
let calls: string[];
let readInbox: ReadInbox;
let held: HeldDeliveries;
let crewToken: string;
let waitingDeps: Parameters<typeof waitingFor>[0];

beforeEach<{ isFresh: boolean }>(async ({ isFresh }) => {
  fleet = await startFleetServer(inject('postgresUrl'), { isFresh });
  const cookie = await signIn(fleet);
  const charlotte = await commission(fleet, { cookie, ship: { name: 'charlotte', type: 'person', kind: 'person' } });
  charlotteShipId = charlotte.shipId;
  const charlotteCrew = await register(fleet, charlotte);
  crewToken = charlotteCrew;
  tracker = await register(fleet, await commission(fleet, { cookie, ship: { name: 'tracker', type: 'issue-tracker', kind: 'app' } }));
  const crews = memoryPersonCrews();
  // The gateway crews Charlotte's person ship: the fakes know it by the tests' ids, the fleet by its own.
  await crews.save({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, crewToken: charlotteCrew, crewedAt: new Date() });
  calls = [];
  held = createHeldDeliveries(FIXED_CLOCK);
  const door = holdingDoor(counted(createRestFleetDoor(fleet.url).person, calls), { held, letGo: memoryLetGoDeliveries() });
  waitingDeps = { crewPersonShip: fakeCrewPersonShip(crews), crews, door, held };
  readInbox = createReadInbox({
    crewPersonShip: fakeCrewPersonShip(crews),
    crews,
    door,
    held,
    opened: memoryOpenedDeliveries(),
    routes: memoryRoutes([]),
    defaults: routingDefaultsOf(ITEM_JOBS.map((job) => ({ job, place: 'chat' as const }))),
    connections: memoryConnectionStore(),
  });
  for (let number = 1; number <= WAITING; number += 1) {
    await trackerAsks(number);
  }
});

afterEach(async () => {
  await fleet.stop();
});

/** The door, telling each call it makes. */
function counted(door: PersonShipDoor, told: string[]): PersonShipDoor {
  return {
    ...door,
    inbox: (crewToken, wait) => {
      told.push('inbox');
      return door.inbox(crewToken, wait);
    },
    pushReceive: (crewToken, take) => {
      told.push('pushReceive');
      return door.pushReceive(crewToken, take);
    },
  };
}

async function trackerAsks(number: number): Promise<void> {
  const question = JSON.stringify({ id: crypto.randomUUID(), title: `Question ${String(number)}`, context: '', options: [{ key: 1, label: 'Yes' }], pick: { option: 1, why: 'It is ready.' } });
  const sent = await fetch(`${fleet.url}/api/v1/ship/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tracker}` },
    body: JSON.stringify({ selector: { kind: 'ship', name: 'charlotte' }, contentType: 'application/vnd.aeolus.question+json', payload: question, idempotencyKey: crypto.randomUUID() }),
  });
  expect(sent.status).toBe(200);
}

/** How many DeliveryReceived events core wrote for Charlotte's person ship. */
async function deliveriesReceived(): Promise<number> {
  const core = createPrismaClient(fleet.databaseUrl);
  try {
    const rows = await core.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM "events" WHERE "type" = 'DeliveryReceived' AND "ship_id" = ${charlotteShipId}`;
    return Number(rows[0]?.count ?? 0);
  } finally {
    await core.$disconnect();
  }
}

/** How many deliveries a look listed as waiting. */
async function listed(): Promise<number> {
  const read = await readInbox(CHARLOTTE_GRANT);
  return read.isOk ? read.value.deliveries.length : -1;
}

describe('a look at more than 10 waiting is a read (aeolus-fleet #1647)', () => {
  it('receives nothing again and writes no delivery again once the gateway holds what waits', async () => {
    await listed();
    const [receivedBefore, callsBefore] = [await deliveriesReceived(), calls.length];

    const second = await listed();

    expect({ listed: second, pushReceives: calls.slice(callsBefore).filter((call) => call === 'pushReceive').length, deliveriesReceived: (await deliveriesReceived()) - receivedBefore }).toEqual({
      listed: WAITING,
      pushReceives: 0,
      deliveriesReceived: 0,
    });
  });

  freshFleetTest('lists every one at once while another receive holds the first 10', async () => {
    await listed();
    const core = createPrismaClient(fleet.databaseUrl);
    try {
      // A concurrent receive, such as another of Bridge's looks, holds the oldest 10 rows until it commits.
      const look = await core.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "deliveries" WHERE "recipient_ship_id" = ${charlotteShipId} ORDER BY "created_at", "id" LIMIT ${ONE_RECEIVE} FOR UPDATE`;
        const startedAt = Date.now();
        const count = await listed();
        return { listed: count, isAtOnce: Date.now() - startedAt < 5_000 };
      });

      expect(look).toEqual({ listed: WAITING, isAtOnce: true });
    } finally {
      await core.$disconnect();
    }
  });
});

// Keep core's claims overlapping so the competing receive encounters SKIP LOCKED.
describe('concurrent person inbox reads (#370)', () => {
  for (const otherRead of ['waitingFor', 'waitingOn'] as const) {
    freshFleetTest(`shares all 14 deliveries between waitingFor and ${otherRead}`, async () => {
      // Start with seven held deliveries and seven pending, as a busy person receives more.
      const initial = await waitingDeps.door.pushReceive(crewToken, { max: 7 });
      expect(initial.isOk).toBe(true);
      if (initial.isOk) held.hold(crewToken, initial.value);
      const pending = await waitingDeps.door.pushReceive(crewToken, { max: 1, excluding: (held.of(crewToken) ?? []).map(({ deliveryId }) => deliveryId) });
      const removed = pending.isOk ? pending.value[0] : undefined;
      if (removed === undefined) throw new Error('Expected the initial deliveries');
      expect(await waitingDeps.door.ack(crewToken, removed.deliveryId)).toEqual({ isOk: true, value: undefined });
      held.hold(crewToken, (held.of(crewToken) ?? []).slice(0, 7));
      const core = createPrismaClient(fleet.databaseUrl);
      try {
        await core.$executeRawUnsafe(`CREATE FUNCTION slow_delivery_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.05); RETURN NEW; END $$`);
        await core.$executeRawUnsafe(`CREATE TRIGGER slow_delivery_claim BEFORE UPDATE ON deliveries FOR EACH ROW EXECUTE FUNCTION slow_delivery_claim()`);
        const originalDoor = waitingDeps.door;
        const countsReady = Promise.withResolvers<undefined>();
        let countedReads = 0;
        const timeout = setTimeout(() => { countsReady.resolve(undefined); }, 100);
        waitingDeps.door = { ...waitingDeps.door, inbox: async (token, wait) => {
          const answer = await originalDoor.inbox(token, wait);
          countedReads += 1;
          if (countedReads === 2) { clearTimeout(timeout); countsReady.resolve(undefined); }
          await countsReady.promise;
          return answer;
        } };
        const [first, second] = await Promise.all([
          waitingFor(waitingDeps, CHARLOTTE_GRANT),
          otherRead === 'waitingFor' ? waitingFor(waitingDeps, CHARLOTTE_GRANT) : waitingOn(waitingDeps, crewToken),
        ]);
        expect(first.isOk ? first.value.deliveries.length : first.error).toBe(14);
        expect(second.isOk ? (Array.isArray(second.value) ? second.value.length : second.value.deliveries.length) : second.error).toBe(14);
        expect(held.of(crewToken)).toHaveLength(14);
      } finally {
        await core.$disconnect();
      }
    });
  }
});

describe('person inbox reads after a delivery is accepted (#423)', () => {
  freshFleetTest('reads the new delivery while a read from before its acceptance is still running', async () => {
    await listed();
    const originalDoor = waitingDeps.door;
    const counted = Promise.withResolvers<undefined>();
    const continueFirst = Promise.withResolvers<undefined>();
    let isFirst = true;
    waitingDeps.door = {
      ...originalDoor,
      inbox: async (token, wait) => {
        const answer = await originalDoor.inbox(token, wait);
        if (isFirst) {
          isFirst = false;
          counted.resolve(undefined);
          await continueFirst.promise;
        }
        return answer;
      },
    };
    const first = waitingFor(waitingDeps, CHARLOTTE_GRANT);
    await counted.promise;
    await trackerAsks(16);

    const later = waitingFor(waitingDeps, CHARLOTTE_GRANT);
    continueFirst.resolve(undefined);
    const [before, after] = await Promise.all([first, later]);

    expect(before.isOk && before.value.deliveries.length).toBe(15);
    expect(after.isOk && { waiting: after.value.waiting, deliveries: after.value.deliveries.length }).toEqual({ waiting: 16, deliveries: 16 });
    expect(held.of(crewToken)).toHaveLength(16);
  });
});
