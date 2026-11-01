import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aBasketEntry, aPersonDelivery, CHARLOTTE_GRANT, fakeCrewPersonShip, fakePersonShipDoor, memoryBasketEntries, memoryInboxChanges, memoryItemOutcomes, memoryOpenedDeliveries, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { BasketEntry } from './basket.js';
import type { OpenedDelivery, PersonDelivery } from './ports.js';
import { createRemoveFromBasket } from './remove-from-basket.js';

// Remove (Bridge, section 9, rules 2, 5 and the refused path): the entry
// leaves the basket. A waiting one's question still waits; a refused one's
// question is done, not sent; a withdrawn or replaced one's question is done
// as such.

const AT = new Date('2026-10-31T20:20:00.000Z');
const CREW_TOKEN = 'aeolus_ct_v1_charlotte';
const HARBOUR = aBasketEntry();

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
    sentAt: entry.sentAt,
    openedAt: new Date('2026-10-31T19:50:00.000Z'),
  };
}

let entries: ReturnType<typeof memoryBasketEntries>;
let opened: ReturnType<typeof memoryOpenedDeliveries>;
let outcomes: ReturnType<typeof memoryItemOutcomes>;
let changes: ReturnType<typeof memoryInboxChanges>;

beforeEach(() => {
  entries = memoryBasketEntries();
  opened = memoryOpenedDeliveries();
  outcomes = memoryItemOutcomes();
  changes = memoryInboxChanges();
});

async function store(entry: BasketEntry) {
  await entries.save(entry);
  await opened.save(openedOf(entry));
}

function removeWith(deliveries: PersonDelivery[] = []) {
  const crews = memoryPersonCrews();
  const ship = fakePersonShipDoor({ crewToken: CREW_TOKEN, deliveries });
  return { ...ship, remove: createRemoveFromBasket({ crewPersonShip: fakeCrewPersonShip(crews), crews, door: ship.door, opened, entries, outcomes, changes, clock: { now: () => AT } }) };
}

describe('a person removes an entry from the basket', () => {
  it('takes a waiting entry out, and its question still waits on them, sending nothing', async () => {
    await store(HARBOUR);
    const { remove, calls } = removeWith();

    const removed = await remove({ caller: CHARLOTTE_GRANT, questionId: HARBOUR.questionId });

    expect(removed).toEqual({ isOk: true, value: { questionId: HARBOUR.questionId } });
    expect({ basket: entries.held.size, opened: opened.held.size, outcomes: outcomes.held }).toEqual({ basket: 0, opened: 1, outcomes: [] });
    expect(calls.filter((call) => call.startsWith('reply') || call.startsWith('handled'))).toEqual([]);
  });

  it("tells the person's pages", async () => {
    await store(HARBOUR);

    await removeWith().remove({ caller: CHARLOTTE_GRANT, questionId: HARBOUR.questionId });

    expect(changes.told).toEqual([{ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID }]);
  });

  it('takes a refused entry out and marks its question done, as not sent', async () => {
    await store({ ...HARBOUR, state: 'refused', refusal: 'orchestrator-1 did not take the answer: Ship orchestrator-1 was retired' });
    const { remove, calls } = removeWith();

    await remove({ caller: CHARLOTTE_GRANT, questionId: HARBOUR.questionId });

    expect(entries.held.size).toBe(0);
    expect(calls).toContain(`handled(${HARBOUR.deliveryId})`);
    expect(outcomes.held).toEqual([{ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, deliveryId: HARBOUR.deliveryId, place: 'bridge', kind: 'notSent', option: 2, at: AT }]);
  });

  it('keeps a refused entry when the fleet does not take that its question is done, so the person can remove it again', async () => {
    await store({ ...HARBOUR, state: 'refused', refusal: 'orchestrator-1 did not take the answer: Ship orchestrator-1 was retired' });
    const { remove, refusals } = removeWith();
    refusals.handled.push({ code: 'UNAVAILABLE', message: 'The fleet did not answer: fetch failed' });

    const removed = await remove({ caller: CHARLOTTE_GRANT, questionId: HARBOUR.questionId });

    expect(removed).toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
    expect(entries.held.size).toBe(1);
  });

  it('takes a withdrawn entry out and is done with its question as withdrawn', async () => {
    await store(HARBOUR);
    const withdrawal = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0w01', senderShipId: HARBOUR.senderShipId, contentType: 'application/vnd.aeolus.question-withdrawal+json', askedQuestionId: null, withdrawnQuestionId: HARBOUR.questionId });

    await removeWith([withdrawal]).remove({ caller: CHARLOTTE_GRANT, questionId: HARBOUR.questionId });

    expect(entries.held.size).toBe(0);
    expect(outcomes.held).toMatchObject([{ deliveryId: HARBOUR.deliveryId, kind: 'withdrawn' }, { deliveryId: withdrawal.deliveryId, kind: 'seen' }]);
  });

  it('takes an entry answered elsewhere out, sending nothing', async () => {
    await store(HARBOUR);
    await outcomes.save({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, deliveryId: HARBOUR.deliveryId, place: 'slack', kind: 'answered', option: 3, at: AT });
    const { remove, calls } = removeWith();

    await remove({ caller: CHARLOTTE_GRANT, questionId: HARBOUR.questionId });

    expect(entries.held.size).toBe(0);
    expect(calls.filter((call) => call.startsWith('reply') || call.startsWith('handled'))).toEqual([]);
  });

  it('refuses to remove an entry being sent: it goes as stored', async () => {
    await store({ ...HARBOUR, state: 'sending' });

    const removed = await removeWith().remove({ caller: CHARLOTTE_GRANT, questionId: HARBOUR.questionId });

    expect(removed).toMatchObject({ isOk: false, error: { kind: 'CONFLICT' } });
    expect(entries.held.size).toBe(1);
  });

  it('refuses to remove an entry sent: its answer is stored, and the next Put or Send clears it', async () => {
    await store({ ...HARBOUR, state: 'sent', storedAt: new Date('2026-10-31T20:16:00.000Z') });

    const removed = await removeWith().remove({ caller: CHARLOTTE_GRANT, questionId: HARBOUR.questionId });

    expect(removed).toMatchObject({ isOk: false, error: { kind: 'CONFLICT' } });
    expect(entries.held.size).toBe(1);
  });

  it('refuses a question with no entry in the basket', async () => {
    const removed = await removeWith().remove({ caller: CHARLOTTE_GRANT, questionId: HARBOUR.questionId });

    expect(removed).toMatchObject({ isOk: false, error: { kind: 'NOT_IN_BASKET' } });
  });
});
