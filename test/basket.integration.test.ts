import { receiveOutputSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { createPrismaBasketEntries } from '../src/adapters/prisma/basket-entries.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaItemOutcomes } from '../src/adapters/prisma/item-outcomes.js';
import { createPrismaOpenedDeliveries } from '../src/adapters/prisma/opened-deliveries.js';
import { createPrismaPersonCrews } from '../src/adapters/prisma/person-crews.js';
import type { BasketEntry } from '../src/core/people/basket.js';
import type { PersonShipDoor } from '../src/core/people/ports.js';
import { createSendStoredAnswers } from '../src/core/people/send-stored-answers.js';
import { commission, register, retire, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';

// The basket sent, against a real core and the gateway's own Postgres
// (Bridge, section 9): Charlotte answers three questions into the basket and
// sends it; each asker receives one ordinary answer, in reply to its
// question. Sent twice at once, or again after a gateway restart, each is
// stored once; one the fleet refuses stays in the basket, saying why.

const QUESTION = 'application/vnd.aeolus.question+json';
const ANSWER = 'application/vnd.aeolus.answer+json';
const AT = new Date('2026-10-31T20:16:00.000Z');

let prisma: PrismaClient;
let fleet: FleetServer;
let cookie: string;
let door: PersonShipDoor;
let fleetId: FleetId;
let charlotte: { shipId: ShipId; crewToken: string };
let askers: Record<'orchestrator' | 'commercial' | 'builder', { shipId: ShipId; crewToken: string }>;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function aShip(ship: { name: string; type: string; kind: 'person' | 'app' }) {
  const commissioned = await commission(fleet, { cookie, ship });
  return { shipId: commissioned.shipId, crewToken: await register(fleet, commissioned) };
}

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  cookie = await signIn(fleet);
  door = createRestFleetDoor(fleet.url).person;
  charlotte = await aShip({ name: 'charlotte', type: 'person', kind: 'person' });
  const who = await createRestFleetDoor(fleet.url).whoami(charlotte.crewToken);
  if (!who.isOk) {
    throw new Error(`charlotte is not crewed: ${who.error.message}`);
  }
  fleetId = who.value.fleetId;
  // Each test runs its own core: a basket or crew kept by an earlier one is not this fleet's.
  await prisma.basketEntry.deleteMany({});
  await prisma.personCrew.deleteMany({});
  askers = {
    orchestrator: await aShip({ name: 'orchestrator-1', type: 'orchestrator', kind: 'app' }),
    commercial: await aShip({ name: 'commercial', type: 'commercial', kind: 'app' }),
    builder: await aShip({ name: 'builder-core', type: 'builder', kind: 'app' }),
  };
});

afterEach(async () => {
  await fleet.stop();
});

/** The asker sends Charlotte a question; she opens it in Bridge, which acknowledges it, and puts option 1 in the basket, then presses Send. */
async function answeredIntoTheBasket(asker: { shipId: ShipId; crewToken: string }, question: { id: string; title: string; addedAt: Date }): Promise<BasketEntry> {
  const payload = JSON.stringify({ id: question.id, title: question.title, context: '', options: [{ key: 1, label: 'Yes' }, { key: 2, label: 'No' }], pick: { option: 1, why: 'It is ready' } });
  const sent = await fetch(`${fleet.url}/api/v1/ship/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${asker.crewToken}` },
    body: JSON.stringify({ selector: { kind: 'ship', name: 'charlotte' }, contentType: QUESTION, payload, idempotencyKey: question.id }),
  });
  expect(sent.status).toBe(200);
  const taken = await door.pushReceive(charlotte.crewToken, { max: 1 });
  const [delivery] = taken.isOk ? taken.value : [];
  if (delivery === undefined) {
    throw new Error('charlotte received no question');
  }
  expect((await door.ack(charlotte.crewToken, delivery.deliveryId)).isOk).toBe(true);
  await createPrismaOpenedDeliveries(prisma).save({
    fleetId,
    shipId: charlotte.shipId,
    deliveryId: delivery.deliveryId,
    messageId: delivery.messageId,
    senderShipId: delivery.senderShipId,
    from: delivery.senderName,
    title: question.title,
    contentType: QUESTION,
    askedQuestionId: question.id,
    withdrawnQuestionId: null,
    stepId: null,
    withdrawnStepId: null,
    sentAt: delivery.sentAt,
    openedAt: AT,
  });
  const entry: BasketEntry = {
    fleetId,
    shipId: charlotte.shipId,
    questionId: question.id,
    deliveryId: delivery.deliveryId,
    messageId: delivery.messageId,
    senderShipId: delivery.senderShipId,
    from: delivery.senderName,
    title: question.title,
    sentAt: delivery.sentAt,
    option: 1,
    note: null,
    addedAt: question.addedAt,
    state: 'sending',
    refusal: null,
  };
  await createPrismaBasketEntries(prisma).save(entry);
  return entry;
}

/** What waits for an asker, as its crew receives it. */
async function received(asker: { crewToken: string }) {
  const response = await fetch(`${fleet.url}/api/v1/ship/receive`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${asker.crewToken}` },
    body: JSON.stringify({ max: 10 }),
  });
  return receiveOutputSchema.parse(await response.json()).deliveries.map(({ senderName, contentType, payload, inReplyTo }) => ({ senderName, contentType, payload, inReplyTo }));
}

/** The gateway's sender, as one instance runs it with this door; a new one is the gateway after a restart. */
function aSender(withDoor: PersonShipDoor = door) {
  return createSendStoredAnswers({
    entries: createPrismaBasketEntries(prisma),
    crews: createPrismaPersonCrews(prisma),
    door: withDoor,
    opened: createPrismaOpenedDeliveries(prisma),
    outcomes: createPrismaItemOutcomes(prisma),
    changes: { tell: () => Promise.resolve() },
    clock: { now: () => AT },
  });
}

async function crewCharlotte() {
  await createPrismaPersonCrews(prisma).save({ fleetId, shipId: charlotte.shipId, crewToken: charlotte.crewToken, crewedAt: AT });
}

describe('the basket sent through a real core', () => {
  it('gives each asker one answer to its question, in reply to it, sent twice at once and once more after a restart', async () => {
    await crewCharlotte();
    const harbour = await answeredIntoTheBasket(askers.orchestrator, { id: '9b2f6c1e-4a7d-4e0b-8c3f-2d5a6b7c8d9e', title: 'Which goes first: the Compact look (U4) or Harbour?', addedAt: new Date('2026-10-31T19:53:00.000Z') });
    const pricing = await answeredIntoTheBasket(askers.commercial, { id: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b', title: 'Pricing page: a price per ship, or plans only?', addedAt: new Date('2026-10-31T19:55:00.000Z') });
    const retention = await answeredIntoTheBasket(askers.builder, { id: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d', title: 'Record retention for person ships: 90 days or 1 year?', addedAt: new Date('2026-10-31T19:57:00.000Z') });

    await Promise.all([aSender()(), aSender()()]);
    await aSender()();

    const answerTo = (entry: BasketEntry) => [{ senderName: 'charlotte', contentType: ANSWER, payload: JSON.stringify({ questionId: entry.questionId, option: 1 }), inReplyTo: entry.messageId }];
    await expect(Promise.all([received(askers.orchestrator), received(askers.commercial), received(askers.builder)])).resolves.toEqual([answerTo(harbour), answerTo(pricing), answerTo(retention)]);
    await expect(createPrismaBasketEntries(prisma).list(fleetId, charlotte.shipId)).resolves.toEqual([]);
    expect((await door.delivery(charlotte.crewToken, harbour.deliveryId)).isOk).toBe(false);
  });

  it('goes on after a gateway restart between the fleet storing an answer and its question reported handled: the asker holds one answer, and the question is handled', async () => {
    await crewCharlotte();
    const harbour = await answeredIntoTheBasket(askers.orchestrator, { id: '9b2f6c1e-4a7d-4e0b-8c3f-2d5a6b7c8d9e', title: 'Which goes first: the Compact look (U4) or Harbour?', addedAt: new Date('2026-10-31T19:53:00.000Z') });
    const stoppedBeforeHandled: PersonShipDoor = { ...door, handled: () => Promise.resolve({ isOk: false, error: { code: 'UNAVAILABLE', message: 'The gateway stopped' } }) };
    await aSender(stoppedBeforeHandled)();

    await aSender()();

    await expect(received(askers.orchestrator)).resolves.toHaveLength(1);
    await expect(createPrismaBasketEntries(prisma).list(fleetId, charlotte.shipId)).resolves.toEqual([]);
    await expect(createPrismaItemOutcomes(prisma).findMany(fleetId, { shipId: charlotte.shipId, deliveryIds: [harbour.deliveryId] })).resolves.toMatchObject([{ place: 'bridge', kind: 'answered', option: 1 }]);
  });

  it('keeps an answer to a retired asker in the basket, refused and saying why, and sends the others', async () => {
    await crewCharlotte();
    const harbour = await answeredIntoTheBasket(askers.orchestrator, { id: '9b2f6c1e-4a7d-4e0b-8c3f-2d5a6b7c8d9e', title: 'Which goes first: the Compact look (U4) or Harbour?', addedAt: new Date('2026-10-31T19:53:00.000Z') });
    const pricing = await answeredIntoTheBasket(askers.commercial, { id: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b', title: 'Pricing page: a price per ship, or plans only?', addedAt: new Date('2026-10-31T19:55:00.000Z') });
    await retire(fleet, { cookie, shipId: askers.commercial.shipId });

    await expect(aSender()()).resolves.toEqual({ sent: 1, kept: 0, refused: 1 });

    await expect(received(askers.orchestrator)).resolves.toHaveLength(1);
    const left = await createPrismaBasketEntries(prisma).list(fleetId, charlotte.shipId);
    expect(left.map(({ questionId, state }) => ({ questionId, state }))).toEqual([{ questionId: pricing.questionId, state: 'refused' }]);
    expect(left[0]?.refusal).toMatch(/^commercial did not take the answer: ./);
    expect(harbour.questionId).not.toBe(pricing.questionId);
  });
});
