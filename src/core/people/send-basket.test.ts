import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aBasketEntry, aPersonDelivery, CHARLOTTE_GRANT, fakeCrewPersonShip, fakePersonShipDoor, memoryBasketEntries, memoryInboxChanges, memoryItemOutcomes, memoryOpenedDeliveries, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { BasketEntry } from './basket.js';
import type { OpenedDelivery, PersonDelivery } from './ports.js';
import { createSendBasket } from './send-basket.js';
import { createSendStoredAnswers } from './send-stored-answers.js';

// Send N answers (Bridge, section 9, rule 3): only when the person presses
// it. The gateway first stores each entry as sending, then sends each; a
// withdrawn, replaced or answered-elsewhere entry is not sent: Send skips it,
// says so, and takes it out.

const AT = new Date('2026-10-31T20:16:00.000Z');
const CREW_TOKEN = 'aeolus_ct_v1_charlotte';

const HARBOUR = aBasketEntry();
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
});

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
let crews: ReturnType<typeof memoryPersonCrews>;
let woken: number;

beforeEach(() => {
  entries = memoryBasketEntries();
  opened = memoryOpenedDeliveries();
  outcomes = memoryItemOutcomes();
  changes = memoryInboxChanges();
  crews = memoryPersonCrews();
  woken = 0;
});

async function store(...stored: BasketEntry[]) {
  for (const entry of stored) {
    await entries.save(entry);
    await opened.save(openedOf(entry));
  }
}

function sendBasketWith(deliveries: PersonDelivery[]) {
  const ship = fakePersonShipDoor({ crewToken: CREW_TOKEN, deliveries });
  const deps = { crewPersonShip: fakeCrewPersonShip(crews), crews, door: ship.door, opened, entries, outcomes, changes, clock: { now: () => AT } };
  return { ...ship, sendBasket: createSendBasket({ ...deps, sendNow: () => { woken += 1; } }), sendStored: createSendStoredAnswers(deps) };
}

describe('Send N answers', () => {
  it('stores each entry waiting as sending and wakes the gateway to send them, sending nothing itself', async () => {
    await store(HARBOUR, PRICING);
    const { sendBasket, replies } = sendBasketWith([]);

    const sent = await sendBasket(CHARLOTTE_GRANT);

    expect(sent).toEqual({ isOk: true, value: { sending: 2, skipped: [] } });
    expect([...entries.held.values()].map(({ state }) => state)).toEqual(['sending', 'sending']);
    expect({ woken, replies }).toEqual({ woken: 1, replies: [] });
  });

  it("tells the person's pages, which show each entry sending", async () => {
    await store(HARBOUR);

    await sendBasketWith([]).sendBasket(CHARLOTTE_GRANT);

    expect(changes.told).toEqual([{ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID }]);
  });

  it('sends each answer once when pressed twice, or on two devices: the key is the question\'s', async () => {
    await store(HARBOUR, PRICING);
    const { sendBasket, sendStored, replies } = sendBasketWith([]);

    await sendBasket(CHARLOTTE_GRANT);
    await sendBasket(CHARLOTTE_GRANT);
    await Promise.all([sendStored(), sendStored()]);

    expect(new Set(replies.map(({ idempotencyKey }) => idempotencyKey))).toEqual(new Set([`answer-${HARBOUR.questionId}`, `answer-${PRICING.questionId}`]));
    expect(entries.held.size).toBe(0);
  });

  it('skips an entry whose question its asker withdrew, says so, takes it out and is done with the question as withdrawn', async () => {
    await store(HARBOUR, PRICING);
    const withdrawal = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0w01', senderShipId: HARBOUR.senderShipId, contentType: 'application/vnd.aeolus.question-withdrawal+json', askedQuestionId: null, withdrawnQuestionId: HARBOUR.questionId });
    const { sendBasket, calls } = sendBasketWith([withdrawal]);

    const sent = await sendBasket(CHARLOTTE_GRANT);

    expect(sent).toEqual({ isOk: true, value: { sending: 1, skipped: [{ questionId: HARBOUR.questionId, title: HARBOUR.title, kind: 'withdrawn' }] } });
    expect([...entries.held.keys()]).toEqual([`${FLEET_ID}/${PERSON_SHIP_ID}/${PRICING.questionId}`]);
    expect(outcomes.held).toMatchObject([{ deliveryId: HARBOUR.deliveryId, place: 'bridge', kind: 'withdrawn' }, { deliveryId: withdrawal.deliveryId, kind: 'seen' }]);
    expect(calls).toContain(`handled(${HARBOUR.deliveryId})`);
  });

  it('skips an entry whose question was replaced and takes it out, the answer not carried to the replacement', async () => {
    await store(PRICING);
    const replacement = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0r01', senderShipId: PRICING.senderShipId, contentType: 'application/vnd.aeolus.question-replacement+json', askedQuestionId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', withdrawnQuestionId: PRICING.questionId });
    const { sendBasket } = sendBasketWith([replacement]);

    const sent = await sendBasket(CHARLOTTE_GRANT);

    expect(sent).toEqual({ isOk: true, value: { sending: 0, skipped: [{ questionId: PRICING.questionId, title: PRICING.title, kind: 'replaced' }] } });
    expect(entries.held.size).toBe(0);
    expect(outcomes.held).toMatchObject([{ deliveryId: PRICING.deliveryId, kind: 'replaced' }]);
    expect(woken).toBe(0);
  });

  it('skips an entry answered elsewhere first and takes it out, sending nothing from it', async () => {
    await store(HARBOUR);
    await outcomes.save({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, deliveryId: HARBOUR.deliveryId, place: 'slack', kind: 'answered', option: 3, at: AT });

    const sent = await sendBasketWith([]).sendBasket(CHARLOTTE_GRANT);

    expect(sent).toEqual({ isOk: true, value: { sending: 0, skipped: [{ questionId: HARBOUR.questionId, title: HARBOUR.title, kind: 'dealtElsewhere' }] } });
    expect(entries.held.size).toBe(0);
  });

  it('does not send again an entry the fleet refused: it stays until removed', async () => {
    const refused = { ...PRICING, state: 'refused' as const, refusal: 'commercial did not take the answer: Ship commercial was retired' };
    await store(refused);

    const sent = await sendBasketWith([]).sendBasket(CHARLOTTE_GRANT);

    expect(sent).toEqual({ isOk: true, value: { sending: 0, skipped: [] } });
    expect([...entries.held.values()]).toEqual([refused]);
  });
});
