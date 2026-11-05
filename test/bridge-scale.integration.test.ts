import { QUESTION_CONTENT_TYPE, RECEIVE_MAX_UPPER_BOUND, WITHDRAWAL_CONTENT_TYPE, type DeliveryId, type ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createHeldDeliveries, holdingDoor } from '../src/core/people/held-deliveries.js';
import type { PersonShipDoor } from '../src/core/people/ports.js';
import { createOpenDelivery } from '../src/core/people/open-delivery.js';
import { createStaleSightings } from '../src/core/people/stale-sightings.js';
import { createReadBridgeHome } from '../src/core/people/read-bridge-home.js';
import { createReadInbox } from '../src/core/people/read-inbox.js';
import { ITEM_JOBS, routingDefaultsOf } from '../src/core/people/routing.js';
import { commission, register, signIn } from './support/argo.js';
import { FLEET_ID, memoryConnectionStore } from './support/fleet-fakes.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';
import { CHARLOTTE_GRANT, fakeCrewPersonShip, memoryBasketEntries, memoryInboxChanges, memoryItemOutcomes, memoryLetGoDeliveries, memoryOpenedDeliveries, memoryPersonCrews, memoryRoutes } from './support/people-fakes.js';
import { memoryPartyStore } from './support/party-fakes.js';
import { PERSON_SHIP_ID } from './support/sign-in-fakes.js';

// Bridge at the load Thomas feels (aeolus-fleet #1651, after #1646 and #1647):
// a person ship with 300 open questions, 100 answered and 50 withdrawn behind
// them, in a fleet with 2,000 retired ships, against a real core. Bridge home,
// the inbox and opening a question are looked at 20 times each, as the
// gateway does once it holds what waits. Each read has its limits: p95 under
// 300 ms, a count of core calls, and no DeliveryReceived event written by a
// look (every look at what waits was a write per question before #1647).
// Each run prints p50, p95, core calls and writes per look.

const OPEN_QUESTIONS = 300;
const ANSWERED_QUESTIONS = 100;
const WITHDRAWN_QUESTIONS = 50;
const RETIRED_SHIPS = 2_000;
const LOOKS = 20;
const SENDS_AT_ONCE = 25;
const SETUP_TIMEOUT_MS = 600_000;
/** The slowest look Thomas stands for. */
const P95_LIMIT_MS = 300;

/** The most core calls one look makes: home counts and reads the record, the inbox counts, opening counts and acknowledges. */
const CORE_CALLS_LIMIT = { 'Bridge home': 2, inbox: 1, 'opening a question': 2 };

let fleet: FleetServer;
let core: PrismaClient;
let tracker: string;
let charlotteCrew: string;
let charlotteShipId: ShipId;
/** The person ship's calls to core since the last look began, by name. */
let calls: string[];
let readHome: ReturnType<typeof createReadBridgeHome>;
let readInbox: ReturnType<typeof createReadInbox>;
let openDelivery: ReturnType<typeof createOpenDelivery>;
/** The questions still open, oldest first, as opening takes them one by one. */
let toOpen: DeliveryId[];

beforeAll(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  core = createPrismaClient(fleet.databaseUrl);
  const cookie = await signIn(fleet);
  const charlotte = await commission(fleet, { cookie, ship: { name: 'charlotte', type: 'person', kind: 'person' } });
  charlotteShipId = charlotte.shipId;
  charlotteCrew = await register(fleet, charlotte);
  tracker = await register(fleet, await commission(fleet, { cookie, ship: { name: 'tracker', type: 'issue-tracker', kind: 'app' } }));
  await retireShips();
  await seedHistory();
  await askOpenQuestions();

  const crews = memoryPersonCrews();
  // The gateway crews Charlotte's person ship: the fakes know it by the tests' ids, the fleet by its own.
  await crews.save({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, crewToken: charlotteCrew, crewedAt: new Date() });
  calls = [];
  const held = createHeldDeliveries();
  const door = holdingDoor(counted(createRestFleetDoor(fleet.url).person, calls), { held, letGo: memoryLetGoDeliveries() });
  const crewPersonShip = fakeCrewPersonShip(crews);
  const [opened, routes, connections] = [memoryOpenedDeliveries(), memoryRoutes([]), memoryConnectionStore()];
  const defaults = routingDefaultsOf(ITEM_JOBS.map((job) => ({ job, place: 'chat' as const })));
  readInbox = createReadInbox({ crewPersonShip, crews, door, held, opened, routes, defaults, connections });
  readHome = createReadBridgeHome({
    crewPersonShip,
    crews,
    door,
    held,
    opened,
    entries: memoryBasketEntries(),
    outcomes: memoryItemOutcomes(),
    changes: memoryInboxChanges(),
    clock: { now: () => new Date() },
    sightings: createStaleSightings(),
    connections,
    routes,
    defaults,
    parties: memoryPartyStore(),
    ownStepPartyOf: () => undefined,
    isEmailOffered: false,
    isWebPushOffered: false,
  });
  openDelivery = createOpenDelivery({ crewPersonShip, crews, door, held, opened, changes: memoryInboxChanges(), outcomes: memoryItemOutcomes(), clock: { now: () => new Date() } });
  // The first look receives what waits once, as the gateway does after a start; the looks measured come after it.
  const first = await readInbox(CHARLOTTE_GRANT);
  toOpen = first.isOk ? first.value.deliveries.map(({ deliveryId }) => deliveryId) : [];
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await core.$disconnect();
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
    record: (crewToken, page) => {
      told.push('record');
      return door.record(crewToken, page);
    },
    ack: (crewToken, deliveryId) => {
      told.push('ack');
      return door.ack(crewToken, deliveryId);
    },
    handled: (crewToken, deliveryId) => {
      told.push('handled');
      return door.handled(crewToken, deliveryId);
    },
  };
}

async function retireShips(): Promise<void> {
  const [fleetRow] = await core.$queryRaw<{ id: string }[]>`SELECT "id" FROM "fleets" LIMIT 1`;
  await core.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes, retired_at)
    SELECT 'shp_1' || lpad(i::text, 25, '0'), ${fleetRow?.id}, 'retired-' || i, 'agent', now(), 'agent', '{}', now()
    FROM generate_series(1, ${RETIRED_SHIPS}::int) i`;
}

async function trackerSends(contentType: string, payload: object): Promise<void> {
  const sent = await fetch(`${fleet.url}/api/v1/ship/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tracker}` },
    body: JSON.stringify({ selector: { kind: 'ship', name: 'charlotte' }, contentType, payload: JSON.stringify(payload), idempotencyKey: crypto.randomUUID() }),
  });
  expect(sent.status).toBe(200);
}

function question(id: string, title: string): object {
  return { id, title, context: '', options: [{ key: 1, label: 'Yes' }] };
}

async function inBatches(count: number, each: (number: number) => Promise<void>): Promise<void> {
  for (let first = 1; first <= count; first += SENDS_AT_ONCE) {
    const numbers = Array.from({ length: Math.min(SENDS_AT_ONCE, count - first + 1) }, (_, offset) => first + offset);
    await Promise.all(numbers.map(each));
  }
}

/** Questions Charlotte answered, and questions their asker withdrew, are all dealt with: the record's history. */
async function seedHistory(): Promise<void> {
  await inBatches(ANSWERED_QUESTIONS, (number) => trackerSends(QUESTION_CONTENT_TYPE, question(crypto.randomUUID(), `Answered ${String(number)}`)));
  const withdrawn = Array.from({ length: WITHDRAWN_QUESTIONS }, () => crypto.randomUUID());
  await inBatches(WITHDRAWN_QUESTIONS, (number) => trackerSends(QUESTION_CONTENT_TYPE, question(withdrawn[number - 1] ?? '', `Withdrawn ${String(number)}`)));
  await inBatches(WITHDRAWN_QUESTIONS, (number) => trackerSends(WITHDRAWAL_CONTENT_TYPE, { questionId: withdrawn[number - 1] }));
  const door = createRestFleetDoor(fleet.url).person;
  const total = ANSWERED_QUESTIONS + 2 * WITHDRAWN_QUESTIONS;
  for (let dealt = 0; dealt < total; ) {
    const taken = await door.pushReceive(charlotteCrew, { max: RECEIVE_MAX_UPPER_BOUND });
    if (!taken.isOk) {
      throw new Error(taken.error.message);
    }
    for (const { deliveryId } of taken.value) {
      await door.ack(charlotteCrew, deliveryId);
      await door.handled(charlotteCrew, deliveryId);
      dealt += 1;
    }
  }
}

/** The 300 open questions, asked after the history so they are the newest in the record. */
async function askOpenQuestions(): Promise<void> {
  await inBatches(OPEN_QUESTIONS, (number) => trackerSends(QUESTION_CONTENT_TYPE, question(crypto.randomUUID(), `Question ${String(number)}`)));
}

async function deliveriesReceived(): Promise<number> {
  const rows = await core.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM "events" WHERE "type" = 'DeliveryReceived' AND "ship_id" = ${charlotteShipId}`;
  return Number(rows[0]?.count ?? 0);
}

function percentile(sorted: readonly number[], share: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)] ?? 0;
}

interface Measured {
  p50: number;
  p95: number;
  callsPerLook: number;
  writesPerLook: number;
}

async function measure(look: () => Promise<unknown>): Promise<Measured> {
  const [receivedBefore, callsBefore] = [await deliveriesReceived(), calls.length];
  const durations: number[] = [];
  for (let each = 0; each < LOOKS; each += 1) {
    const startedAt = performance.now();
    await look();
    durations.push(performance.now() - startedAt);
  }
  const sorted = durations.toSorted((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    callsPerLook: (calls.length - callsBefore) / LOOKS,
    writesPerLook: ((await deliveriesReceived()) - receivedBefore) / LOOKS,
  };
}

describe('Bridge with 300 open questions (aeolus-fleet #1651)', () => {
  it.each([
    ['Bridge home', () => readHome(CHARLOTTE_GRANT)],
    ['inbox', () => readInbox(CHARLOTTE_GRANT)],
    [
      'opening a question',
      async () => {
        const deliveryId = toOpen.shift();
        if (deliveryId === undefined) {
          throw new Error('no open question left to open');
        }
        return openDelivery({ caller: CHARLOTTE_GRANT, deliveryId, place: 'bridge' });
      },
    ],
  ] as const)(
    'looks at %s within its limits',
    async (name, look) => {
      const measured = await measure(look);
      const report = { read: name, 'p50 ms': Math.round(measured.p50), 'p95 ms': Math.round(measured.p95), 'core calls per look': measured.callsPerLook, 'DeliveryReceived writes per look': measured.writesPerLook };
      console.info(JSON.stringify(report));
      expect({ isFast: measured.p95 < P95_LIMIT_MS, callsWithinLimit: measured.callsPerLook <= CORE_CALLS_LIMIT[name], writes: measured.writesPerLook }).toEqual({ isFast: true, callsWithinLimit: true, writes: 0 });
    },
    SETUP_TIMEOUT_MS,
  );
});
