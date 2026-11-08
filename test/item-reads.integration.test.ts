import { QUESTION_CONTENT_TYPE, RECEIVE_MAX_UPPER_BOUND } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import type { BasketEntries } from '../src/core/people/basket.js';
import { createHeldDeliveries, holdingDoor } from '../src/core/people/held-deliveries.js';
import { createReadItem } from '../src/core/people/read-item.js';
import { ITEM_JOBS, routingDefaultsOf, type Routes } from '../src/core/people/routing.js';
import type { ConnectionStore } from '../src/core/connection/ports.js';
import { commission, register, signIn } from './support/argo.js';
import { FLEET_ID, memoryConnectionStore } from './support/fleet-fakes.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';
import { CHARLOTTE_GRANT, aBasketEntry, fakeCrewPersonShip, memoryBasketEntries, memoryLetGoDeliveries, memoryOpenedDeliveries, memoryPersonCrews, memoryRoutes } from './support/people-fakes.js';
import { PERSON_SHIP_ID } from './support/sign-in-fakes.js';
import { FIXED_CLOCK } from './support/fixed-clock.js';

// One item opened from a push, against a real core: its places, its basket
// entry and its message id come from reads bounded to that one item, so they
// stay the same however many unrelated items wait.

const UNRELATED_WAITING = 100;

let fleet: FleetServer;
let tracker: string;
let charlotteCrew: string;
let readItem: ReturnType<typeof createReadItem>;
let entries: BasketEntries;
/** The reads of the person's stores since the last look began, by name. */
let reads: string[];

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  const cookie = await signIn(fleet);
  charlotteCrew = await register(fleet, await commission(fleet, { cookie, ship: { name: 'charlotte', type: 'person', kind: 'person' } }));
  tracker = await register(fleet, await commission(fleet, { cookie, ship: { name: 'tracker', type: 'agent' } }));
  const crews = memoryPersonCrews();
  await crews.save({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, crewToken: charlotteCrew, crewedAt: new Date() });
  const held = createHeldDeliveries(FIXED_CLOCK);
  reads = [];
  entries = counting(memoryBasketEntries());
  readItem = createReadItem({
    crewPersonShip: fakeCrewPersonShip(crews),
    crews,
    door: holdingDoor(createRestFleetDoor(fleet.url).person, { held, letGo: memoryLetGoDeliveries() }),
    held,
    opened: memoryOpenedDeliveries(),
    entries,
    connections: countingConnections(memoryConnectionStore()),
    routes: countingRoutes(memoryRoutes([])),
    defaults: routingDefaultsOf(ITEM_JOBS.map((job) => ({ job, place: 'chat' as const }))),
    isEmailOffered: false,
    isWebPushOffered: false,
  });
});

afterEach(async () => {
  await fleet.stop();
});

function counting(inner: BasketEntries): BasketEntries {
  return {
    ...inner,
    find: (fleetId, asked) => {
      reads.push('basket.find');
      return inner.find(fleetId, asked);
    },
    list: (fleetId, shipId) => {
      reads.push('basket.list');
      return inner.list(fleetId, shipId);
    },
  };
}

function countingRoutes(inner: ReturnType<typeof memoryRoutes>): Routes {
  return {
    ...inner,
    list: (ship) => {
      reads.push('routes.list');
      return inner.list(ship);
    },
  };
}

function countingConnections(inner: ReturnType<typeof memoryConnectionStore>): ConnectionStore {
  return {
    ...inner,
    binding: (fleetId) => {
      reads.push('connections.binding');
      return inner.binding(fleetId);
    },
  };
}

async function trackerAsks(title: string): Promise<string> {
  const id = crypto.randomUUID();
  const sent = await fetch(`${fleet.url}/api/v1/ship/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tracker}` },
    body: JSON.stringify({ selector: { kind: 'ship', name: 'charlotte' }, contentType: QUESTION_CONTENT_TYPE, payload: JSON.stringify({ id, title, context: '', options: [{ key: 1, label: 'Yes' }], pick: { option: 1, why: 'The only one' } }), idempotencyKey: crypto.randomUUID(), model: 'claude-opus-5-5' }),
  });
  expect(sent.status).toBe(200);
  return id;
}

/** The item waiting that asks the question, as the fleet gives it to Charlotte's ship. */
async function waitingAsking(questionId: string) {
  const read = await createRestFleetDoor(fleet.url).person.pushReceive(charlotteCrew, { max: RECEIVE_MAX_UPPER_BOUND });
  if (!read.isOk) {
    throw new Error(read.error.message);
  }
  const found = read.value.find((delivery) => delivery.payload.includes(questionId));
  if (found === undefined) {
    throw new Error(`No item asking ${questionId} waits`);
  }
  return found;
}

describe('people.item reads its places, basket entry and message id for that one item (#326)', () => {
  it('reads the same with 100 unrelated waiting items as with none', async () => {
    const questionId = await trackerAsks('Harbour first?');
    const target = await waitingAsking(questionId);
    await entries.save(aBasketEntry({ questionId, deliveryId: target.deliveryId, option: 1, note: 'Yes' }));
    reads = [];
    const alone = await readItem({ caller: CHARLOTTE_GRANT, deliveryId: target.deliveryId });
    const readsAlone = reads;

    for (let each = 0; each < UNRELATED_WAITING; each += 1) {
      await trackerAsks(`Unrelated ${String(each)}`);
    }
    reads = [];
    const crowded = await readItem({ caller: CHARLOTTE_GRANT, deliveryId: target.deliveryId });

    expect(alone).toMatchObject({ isOk: true, value: { messageId: target.messageId, places: ['chat'], inBasket: { option: 1, note: 'Yes' } } });
    expect(crowded).toEqual(alone);
    expect(reads).toEqual(readsAlone);
    expect(reads).toEqual(['routes.list', 'connections.binding', 'basket.find']);
  });
});
