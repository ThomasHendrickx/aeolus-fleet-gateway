import type { ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { createPrismaClient } from '../src/adapters/prisma/client.js';
import { createHeldDeliveries, holdingDoor } from '../src/core/people/held-deliveries.js';
import type { PersonShipDoor } from '../src/core/people/ports.js';
import { createReadInbox, type ReadInbox } from '../src/core/people/read-inbox.js';
import { ITEM_JOBS, routingDefaultsOf } from '../src/core/people/routing.js';
import { commission, register, signIn } from './support/argo.js';
import { FLEET_ID, memoryConnectionStore } from './support/fleet-fakes.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';
import { CHARLOTTE_GRANT, fakeCrewPersonShip, memoryOpenedDeliveries, memoryPersonCrews, memoryRoutes } from './support/people-fakes.js';
import { PERSON_SHIP_ID } from './support/sign-in-fakes.js';

// A look at Charlotte's inbox, as Bridge and its workers take one, against a
// real core (aeolus-fleet #1647): with more than 10 waiting, a look is a read,
// and lists every one even while another receive holds some of them.

const WAITING = 15;
/** How many deliveries one receive takes at most, as a concurrent look takes them. */
const ONE_RECEIVE = 10;
/** Core waits about 25 seconds on a receive that finds nothing; a look must not. */
const LOOK_TIMEOUT_MS = 60_000;

let fleet: FleetServer;
let charlotteShipId: ShipId;
let tracker: string;
/** The person ship's calls the look made, by name. */
let calls: string[];
let readInbox: ReadInbox;

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  const cookie = await signIn(fleet);
  const charlotte = await commission(fleet, { cookie, ship: { name: 'charlotte', type: 'person', kind: 'person' } });
  charlotteShipId = charlotte.shipId;
  const charlotteCrew = await register(fleet, charlotte);
  tracker = await register(fleet, await commission(fleet, { cookie, ship: { name: 'tracker', type: 'issue-tracker', kind: 'app' } }));
  const crews = memoryPersonCrews();
  // The gateway crews Charlotte's person ship: the fakes know it by the tests' ids, the fleet by its own.
  await crews.save({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, crewToken: charlotteCrew, crewedAt: new Date() });
  calls = [];
  const held = createHeldDeliveries();
  const door = holdingDoor(counted(createRestFleetDoor(fleet.url).person, calls), held);
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
  const question = JSON.stringify({ id: crypto.randomUUID(), title: `Question ${String(number)}`, context: '', options: [{ key: 1, label: 'Yes' }] });
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

  it(
    'lists every one at once while another receive holds the first 10',
    async () => {
      await listed();
      const core = createPrismaClient(fleet.databaseUrl);
      try {
        // A concurrent receive, such as another of Bridge's looks, holds the oldest 10 rows until it commits.
        const look = await core.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT "id" FROM "deliveries" WHERE "recipient_ship_id" = ${charlotteShipId} ORDER BY "created_at", "id" LIMIT ${ONE_RECEIVE} FOR UPDATE`;
            const startedAt = Date.now();
            const count = await listed();
            return { listed: count, isAtOnce: Date.now() - startedAt < 5_000 };
          },
          { timeout: LOOK_TIMEOUT_MS },
        );

        expect(look).toEqual({ listed: WAITING, isAtOnce: true });
      } finally {
        await core.$disconnect();
      }
    },
    LOOK_TIMEOUT_MS,
  );
});
