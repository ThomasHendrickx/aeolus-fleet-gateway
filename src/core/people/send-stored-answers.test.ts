import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aBasketEntry, fakePersonShipDoor, memoryBasketEntries, memoryInboxChanges, memoryItemOutcomes, memoryOpenedDeliveries, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { BasketEntry } from './basket.js';
import type { OpenedDelivery } from './ports.js';
import { createSendStoredAnswers } from './send-stored-answers.js';

// The basket sent (Bridge, section 9, rule 3): the gateway sends each answer
// stored as sending on its own, in the order added, as the person ship, in
// reply to its question, under the question's key. Each the fleet stores is
// handled, done and out of the basket; the rest go on. A restart goes on
// with the same keys: nothing is lost and nothing is sent twice.

const AT = new Date('2026-10-31T20:16:00.000Z');
const CREW_TOKEN = 'aeolus_ct_v1_charlotte';
const ANSWER = 'application/vnd.aeolus.answer+json';

const HARBOUR = aBasketEntry({ state: 'sending' });
const PRICING = aBasketEntry({
  questionId: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b',
  deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002',
  messageId: 'msg_01m3tbfspe96yf1rnr4ank0002',
  senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9cqm',
  from: 'commercial',
  title: 'Pricing page: a price per ship, or plans only?',
  option: 1,
  note: null,
  addedAt: new Date('2026-10-31T19:55:00.000Z'),
  state: 'sending',
});
const RETENTION = aBasketEntry({
  questionId: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d',
  deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0003',
  messageId: 'msg_01m3tbfspe96yf1rnr4ank0003',
  senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9cqr',
  from: 'builder-core',
  title: 'Record retention for person ships: 90 days or 1 year?',
  option: 1,
  note: 'A year only when a customer asks for it.',
  addedAt: new Date('2026-10-31T19:57:00.000Z'),
  state: 'sending',
});

/** The question an entry answers, as Charlotte opened it in Bridge. */
function openedOf(entry: BasketEntry): OpenedDelivery {
  return {
    fleetId: entry.fleetId,
    shipId: entry.shipId,
    deliveryId: entry.deliveryId,
    messageId: entry.messageId,
    senderShipId: entry.senderShipId,
    from: entry.from,
    title: entry.title,
    contentType: 'application/vnd.aeolus.question+json',
    askedQuestionId: entry.questionId,
    withdrawnQuestionId: null,
    stepId: null,
    withdrawnStepId: null,
    stepLink: null,
    openedIn: null,
    sentAt: entry.sentAt,
    openedAt: new Date('2026-10-31T19:50:00.000Z'),
  };
}

let entries: ReturnType<typeof memoryBasketEntries>;
let opened: ReturnType<typeof memoryOpenedDeliveries>;
let outcomes: ReturnType<typeof memoryItemOutcomes>;
let changes: ReturnType<typeof memoryInboxChanges>;
let crews: ReturnType<typeof memoryPersonCrews>;
let ship: ReturnType<typeof fakePersonShipDoor>;

beforeEach(async () => {
  entries = memoryBasketEntries();
  opened = memoryOpenedDeliveries();
  outcomes = memoryItemOutcomes();
  changes = memoryInboxChanges();
  crews = memoryPersonCrews();
  await crews.save({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, crewToken: CREW_TOKEN, crewedAt: AT });
  ship = fakePersonShipDoor({ crewToken: CREW_TOKEN, deliveries: [] });
});

/** The gateway's sender, as one instance runs it; a new one is the gateway after a restart, with what it stored. */
function aSender() {
  return createSendStoredAnswers({ entries, crews, door: ship.door, opened, outcomes, changes, clock: { now: () => AT } });
}

async function store(...stored: BasketEntry[]) {
  for (const entry of stored) {
    await entries.save(entry);
    await opened.save(openedOf(entry));
  }
}

describe('the gateway sends the answers stored as sending', () => {
  it('sends each on its own, in the order added, in reply to its question, as an answer under the question\'s key', async () => {
    await store(RETENTION, PRICING, HARBOUR);

    await aSender()();

    expect(ship.replies).toEqual([
      { to: HARBOUR.senderShipId, inReplyTo: HARBOUR.messageId, contentType: ANSWER, payload: JSON.stringify({ questionId: HARBOUR.questionId, option: 2, note: 'Harbour first: the demo on 12 Nov needs it.' }), idempotencyKey: `answer-${HARBOUR.questionId}` },
      { to: PRICING.senderShipId, inReplyTo: PRICING.messageId, contentType: ANSWER, payload: JSON.stringify({ questionId: PRICING.questionId, option: 1 }), idempotencyKey: `answer-${PRICING.questionId}` },
      { to: RETENTION.senderShipId, inReplyTo: RETENTION.messageId, contentType: ANSWER, payload: JSON.stringify({ questionId: RETENTION.questionId, option: 1, note: 'A year only when a customer asks for it.' }), idempotencyKey: `answer-${RETENTION.questionId}` },
    ]);
  });

  it('reports each one the fleet stored handled, answered in Bridge with its option, out of the basket, and tells the pages', async () => {
    await store(HARBOUR);

    await expect(aSender()()).resolves.toEqual({ sent: 1, kept: 0, refused: 0 });

    expect(ship.calls).toEqual([`reply(${HARBOUR.messageId})`, `handled(${HARBOUR.deliveryId})`]);
    expect(outcomes.held).toEqual([{ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, deliveryId: HARBOUR.deliveryId, place: 'bridge', kind: 'answered', option: 2, note: 'Harbour first: the demo on 12 Nov needs it.', seen: null, at: AT }]);
    expect({ basket: entries.held.size, opened: opened.held.size }).toEqual({ basket: 0, opened: 0 });
    expect(changes.told).toEqual([{ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID }]);
  });

  it('keeps where and when the person opened the question, so Done tells its history', async () => {
    const entry = aBasketEntry({ state: 'sending' });
    await entries.save(entry);
    await opened.save({ ...openedOf(entry), openedIn: 'bridge' });

    await aSender()();

    expect(outcomes.held.map(({ seen }) => seen)).toEqual([{ place: 'bridge', at: new Date('2026-10-31T19:50:00.000Z') }]);
  });

  it('sends an entry with only a note as an answer with the note and no option, kept answered in Bridge with no option', async () => {
    const noteAlone = aBasketEntry({ option: null, note: 'Neither: ask me after the demo.', state: 'sending' });
    await store(noteAlone);

    await aSender()();

    expect(ship.replies).toEqual([{ to: noteAlone.senderShipId, inReplyTo: noteAlone.messageId, contentType: ANSWER, payload: JSON.stringify({ questionId: noteAlone.questionId, note: 'Neither: ask me after the demo.' }), idempotencyKey: `answer-${noteAlone.questionId}` }]);
    expect(outcomes.held).toEqual([{ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, deliveryId: noteAlone.deliveryId, place: 'bridge', kind: 'answered', option: null, note: 'Neither: ask me after the demo.', seen: null, at: AT }]);
  });

  it('sends no entry waiting for Send: no clock sends the basket', async () => {
    await store(aBasketEntry({ state: 'waiting' }));

    await aSender()();

    expect(ship.replies).toEqual([]);
    expect([...entries.held.values()]).toEqual([aBasketEntry({ state: 'waiting' })]);
  });

  it('keeps sending an entry the fleet did not answer, and goes on with the others', async () => {
    await store(HARBOUR, PRICING);
    ship.refusals.reply.push({ code: 'UNAVAILABLE', message: 'The fleet did not answer: fetch failed' });

    await expect(aSender()()).resolves.toEqual({ sent: 1, kept: 1, refused: 0 });

    expect([...entries.held.values()]).toEqual([HARBOUR]);
    expect(ship.replies.map(({ idempotencyKey }) => idempotencyKey)).toEqual([`answer-${PRICING.questionId}`]);
  });

  it('sends it again under the same key at the next round, so it arrives once', async () => {
    await store(HARBOUR);
    ship.refusals.reply.push({ code: 'SERVICE_UNAVAILABLE', message: 'The fleet is busy' });
    const sender = aSender();

    await sender();
    await sender();

    expect(ship.calls.filter((call) => call.startsWith('reply'))).toEqual([`reply(${HARBOUR.messageId})`, `reply(${HARBOUR.messageId})`]);
    expect(ship.replies.map(({ idempotencyKey }) => idempotencyKey)).toEqual([`answer-${HARBOUR.questionId}`]);
    expect(entries.held.size).toBe(0);
  });

  it('keeps one the fleet refused in the basket, not sent, with why, not handled; the others are sent', async () => {
    await store(HARBOUR, PRICING);
    ship.refusals.reply.push({ code: 'NOT_FOUND', message: 'Ship commercial was retired' });
    await entries.save({ ...HARBOUR, addedAt: new Date('2026-10-31T19:59:00.000Z') });

    await expect(aSender()()).resolves.toEqual({ sent: 1, kept: 0, refused: 1 });

    expect([...entries.held.values()]).toEqual([{ ...PRICING, state: 'refused', refusal: 'commercial did not take the answer: Ship commercial was retired' }]);
    expect(ship.calls).not.toContain(`handled(${PRICING.deliveryId})`);
    expect(outcomes.held.map(({ deliveryId }) => deliveryId)).toEqual([HARBOUR.deliveryId]);
  });

  it('sends nothing for a question answered elsewhere first, as Slack or a chat did, and takes the entry out', async () => {
    await store(HARBOUR);
    await outcomes.save({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, deliveryId: HARBOUR.deliveryId, place: 'slack', kind: 'answered', option: 3, at: AT });

    await aSender()();

    expect(ship.replies).toEqual([]);
    expect(entries.held.size).toBe(0);
    expect(outcomes.held).toEqual([{ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, deliveryId: HARBOUR.deliveryId, place: 'slack', kind: 'answered', option: 3, note: null, seen: null, at: AT }]);
  });

  it('keeps sending while the person ship has no crew, sending nothing', async () => {
    await crews.drop(FLEET_ID, PERSON_SHIP_ID);
    await store(HARBOUR);

    await expect(aSender()()).resolves.toEqual({ sent: 0, kept: 1, refused: 0 });

    expect(ship.replies).toEqual([]);
    expect([...entries.held.values()]).toEqual([HARBOUR]);
  });

  it('takes out an answer the fleet stored whose delivery it will not report handled for good, as it was answered', async () => {
    await store(HARBOUR);
    ship.refusals.handled.push({ code: 'DELIVERY_NOT_FOUND', message: 'Delivery dlv_01m3tbfspe96yf1rnr4ank0001 does not exist' });

    await aSender()();

    expect(entries.held.size).toBe(0);
    expect(outcomes.held).toMatchObject([{ deliveryId: HARBOUR.deliveryId, place: 'bridge', kind: 'answered', option: 2 }]);
  });
});

describe('a gateway restart while sending', () => {
  it('sends after the restart what was stored as sending, with the same keys', async () => {
    await store(HARBOUR, PRICING);
    ship.refusals.reply.push({ code: 'UNAVAILABLE', message: 'The fleet did not answer: socket hang up' }, { code: 'UNAVAILABLE', message: 'The fleet did not answer: socket hang up' });
    await aSender()();

    await aSender()();

    expect(ship.replies.map(({ idempotencyKey }) => idempotencyKey)).toEqual([`answer-${HARBOUR.questionId}`, `answer-${PRICING.questionId}`]);
    expect(entries.held.size).toBe(0);
  });

  it('sends one the fleet stored before the stop, and not reported handled, again under the same key, then reports it handled', async () => {
    await store(HARBOUR);
    ship.refusals.handled.push({ code: 'UNAVAILABLE', message: 'The fleet did not answer: socket hang up' });
    await aSender()();

    await aSender()();

    expect(new Set(ship.replies.map(({ idempotencyKey }) => idempotencyKey))).toEqual(new Set([`answer-${HARBOUR.questionId}`]));
    expect(ship.calls).toEqual([`reply(${HARBOUR.messageId})`, `handled(${HARBOUR.deliveryId})`, `reply(${HARBOUR.messageId})`, `handled(${HARBOUR.deliveryId})`]);
    expect(entries.held.size).toBe(0);
  });

  it('sends nothing again for one handled before the stop and not yet out of the basket', async () => {
    await store(HARBOUR);
    await outcomes.save({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, deliveryId: HARBOUR.deliveryId, place: 'bridge', kind: 'answered', option: 2, at: AT });

    await aSender()();

    expect(ship.replies).toEqual([]);
    expect(entries.held.size).toBe(0);
  });
});
