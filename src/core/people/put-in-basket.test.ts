import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { CHARLOTTE_GRANT, fakeCrewPersonShip, memoryBasketEntries, memoryInboxChanges, memoryItemOutcomes, memoryOpenedDeliveries, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { BasketEntry } from './basket.js';
import type { OpenedDelivery } from './ports.js';
import { createPutInBasket } from './put-in-basket.js';

// The basket (Bridge, section 9, rule 1): on a question in Bridge the person
// picks an option, writes a note if they want, and puts it in the basket.
// Nothing is sent. One entry per question: picking again changes it.

const AT = new Date('2026-10-31T19:53:00.000Z');
const LATER = new Date('2026-10-31T19:58:00.000Z');
const QUESTION_ID = '9b2f6c1e-4a7d-4e0b-8c3f-2d5a6b7c8d9e';

/** orchestrator-1's question, as Charlotte opened it in Bridge. */
const OPENED: OpenedDelivery = {
  fleetId: FLEET_ID,
  shipId: PERSON_SHIP_ID,
  deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001',
  messageId: 'msg_01m3tbfspe96yf1rnr4ank0001',
  senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9qrc',
  from: 'orchestrator-1',
  title: 'Which goes first: the Compact look (U4) or Harbour?',
  contentType: 'application/vnd.aeolus.question+json',
  askedQuestionId: QUESTION_ID,
  withdrawnQuestionId: null,
  stepId: null,
  withdrawnStepId: null,
  sentAt: new Date('2026-10-31T19:41:00.000Z'),
  openedAt: new Date('2026-10-31T19:50:00.000Z'),
};

let now: Date;
let opened: ReturnType<typeof memoryOpenedDeliveries>;
let entries: ReturnType<typeof memoryBasketEntries>;
let changes: ReturnType<typeof memoryInboxChanges>;
let outcomes: ReturnType<typeof memoryItemOutcomes>;
let putInBasket: ReturnType<typeof createPutInBasket>;

beforeEach(async () => {
  now = AT;
  const crews = memoryPersonCrews();
  opened = memoryOpenedDeliveries();
  await opened.save(OPENED);
  entries = memoryBasketEntries();
  changes = memoryInboxChanges();
  outcomes = memoryItemOutcomes();
  putInBasket = createPutInBasket({ crewPersonShip: fakeCrewPersonShip(crews), opened, entries, outcomes, changes, clock: { now: () => now } });
});

/** The entry Charlotte's pick of option 2 with a note keeps. */
function anEntry(overrides: Partial<BasketEntry> = {}): BasketEntry {
  return {
    fleetId: FLEET_ID,
    shipId: PERSON_SHIP_ID,
    questionId: QUESTION_ID,
    deliveryId: OPENED.deliveryId,
    messageId: OPENED.messageId,
    senderShipId: OPENED.senderShipId,
    from: 'orchestrator-1',
    title: 'Which goes first: the Compact look (U4) or Harbour?',
    sentAt: new Date('2026-10-31T19:41:00.000Z'),
    option: 2,
    note: 'Harbour first: the demo on 12 Nov needs it.',
    addedAt: AT,
    state: 'waiting',
    refusal: null,
    ...overrides,
  };
}

describe('a person puts an answer to a question in the basket', () => {
  it('keeps the option and the note as an entry of the question, waiting, and sends nothing', async () => {
    const put = await putInBasket({ caller: CHARLOTTE_GRANT, deliveryId: OPENED.deliveryId, option: 2, note: 'Harbour first: the demo on 12 Nov needs it.' });

    expect(put).toEqual({ isOk: true, value: { questionId: QUESTION_ID, option: 2, note: 'Harbour first: the demo on 12 Nov needs it.' } });
    expect([...entries.held.values()]).toEqual([anEntry()]);
  });

  it('keeps a note with no option as an entry of the question, answering it with the note alone', async () => {
    const put = await putInBasket({ caller: CHARLOTTE_GRANT, deliveryId: OPENED.deliveryId, option: null, note: 'Neither: ask me after the demo.' });

    expect(put).toEqual({ isOk: true, value: { questionId: QUESTION_ID, option: null, note: 'Neither: ask me after the demo.' } });
    expect([...entries.held.values()]).toEqual([anEntry({ option: null, note: 'Neither: ask me after the demo.' })]);
  });

  it('refuses an entry with neither an option nor a note, as it answers nothing', async () => {
    const put = await putInBasket({ caller: CHARLOTTE_GRANT, deliveryId: OPENED.deliveryId, option: null, note: '   ' });

    expect(put).toMatchObject({ isOk: false, error: { kind: 'INVALID_ARGUMENTS' } });
    expect(entries.held.size).toBe(0);
  });

  it('puts nothing in the basket for a question answered in Slack first, saying where: a later press in Bridge sends nothing', async () => {
    await outcomes.save({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, deliveryId: OPENED.deliveryId, place: 'slack', kind: 'answered', option: 2, at: AT });

    const put = await putInBasket({ caller: CHARLOTTE_GRANT, deliveryId: OPENED.deliveryId, option: 1, note: '' });

    expect({ put, entries: [...entries.held.values()] }).toEqual({ put: { isOk: false, error: { kind: 'ALREADY_DECIDED', message: 'Already answered in Slack: option 2. Nothing is sent.' } }, entries: [] });
  });

  it('keeps no note when the person wrote none, or only spaces', async () => {
    await putInBasket({ caller: CHARLOTTE_GRANT, deliveryId: OPENED.deliveryId, option: 1, note: '   ' });

    expect([...entries.held.values()]).toEqual([anEntry({ option: 1, note: null })]);
  });

  it("tells the person's pages, so every device shows the same basket", async () => {
    await putInBasket({ caller: CHARLOTTE_GRANT, deliveryId: OPENED.deliveryId, option: 2, note: '' });

    expect(changes.told).toEqual([{ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID }]);
  });

  it('changes the entry when the person picks again on the question, keeping its place in the order added', async () => {
    await putInBasket({ caller: CHARLOTTE_GRANT, deliveryId: OPENED.deliveryId, option: 2, note: 'Harbour first: the demo on 12 Nov needs it.' });
    now = LATER;

    await putInBasket({ caller: CHARLOTTE_GRANT, deliveryId: OPENED.deliveryId, option: 3, note: '' });

    expect([...entries.held.values()]).toEqual([anEntry({ option: 3, note: null, addedAt: AT })]);
  });

  it('refuses a delivery the person has not opened, as nothing of it is known', async () => {
    const put = await putInBasket({ caller: CHARLOTTE_GRANT, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0404', option: 1, note: '' });

    expect(put).toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_DELIVERY' } });
    expect(entries.held.size).toBe(0);
  });

  it('refuses a delivery that asks no question: only answers to questions go in the basket', async () => {
    await opened.save({ ...OPENED, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0txt', contentType: 'text/plain', askedQuestionId: null });

    const put = await putInBasket({ caller: CHARLOTTE_GRANT, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0txt', option: 1, note: '' });

    expect(put).toMatchObject({ isOk: false, error: { kind: 'NOT_A_QUESTION' } });
    expect(entries.held.size).toBe(0);
  });

  it('refuses an option below 1, as options are numbered from 1', async () => {
    const put = await putInBasket({ caller: CHARLOTTE_GRANT, deliveryId: OPENED.deliveryId, option: 0, note: '' });

    expect(put).toMatchObject({ isOk: false, error: { kind: 'INVALID_ARGUMENTS' } });
  });

  it('refuses to change an entry being sent, which goes as stored', async () => {
    await entries.save(anEntry({ state: 'sending' }));

    const put = await putInBasket({ caller: CHARLOTTE_GRANT, deliveryId: OPENED.deliveryId, option: 3, note: '' });

    expect(put).toMatchObject({ isOk: false, error: { kind: 'CONFLICT' } });
    expect([...entries.held.values()]).toEqual([anEntry({ state: 'sending' })]);
  });

  it('refuses to change an entry the fleet refused: it is removed, not sent again', async () => {
    await entries.save(anEntry({ state: 'refused', refusal: 'orchestrator-1 was retired' }));

    const put = await putInBasket({ caller: CHARLOTTE_GRANT, deliveryId: OPENED.deliveryId, option: 3, note: '' });

    expect(put).toMatchObject({ isOk: false, error: { kind: 'CONFLICT' } });
  });

  it("keeps the person ship's basket apart from another fleet's", async () => {
    await entries.save(anEntry({ fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8zz', option: 1 }));

    await putInBasket({ caller: CHARLOTTE_GRANT, deliveryId: OPENED.deliveryId, option: 2, note: 'Harbour first: the demo on 12 Nov needs it.' });

    await expect(entries.list(FLEET_ID, PERSON_SHIP_ID)).resolves.toEqual([anEntry()]);
  });
});
