import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aBasketEntry, aPersonDelivery, CHARLOTTE_GRANT, fakeCrewPersonShip, fakePersonShipDoor, memoryBasketEntries, memoryOpenedDeliveries, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { OpenedDelivery, PersonDelivery } from './ports.js';
import { createReadBridgeHome } from './read-bridge-home.js';

// Bridge home (docs/design/bridge, CC18): what waits on the person with one
// count, decide and do, and the stay-aware feed beside it, outside the count.

let crews: ReturnType<typeof memoryPersonCrews>;
let opened: ReturnType<typeof memoryOpenedDeliveries>;
let entries: ReturnType<typeof memoryBasketEntries>;

beforeEach(() => {
  crews = memoryPersonCrews();
  opened = memoryOpenedDeliveries();
  entries = memoryBasketEntries();
});

function readHome(deliveries: PersonDelivery[]) {
  const ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries });
  return { ...ship, readHome: createReadBridgeHome({ crewPersonShip: fakeCrewPersonShip(crews), crews, door: ship.door, opened, entries }) };
}

const QUESTION = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', sentAt: new Date('2026-10-31T19:48:00.000Z'), senderName: 'orchestrator-1', headline: 'Which goes first: the Compact look (U4) or Harbour?' });
const STEP = aPersonDelivery({
  deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002',
  sentAt: new Date('2026-10-31T19:00:00.000Z'),
  senderName: 'orchestrator-1',
  contentType: 'application/vnd.aeolus.step+json',
  payload: '{"id":"6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10","title":"Create the GitHub repository aeolus-fleet-memory-plugin","why":""}',
  headline: 'Create the GitHub repository aeolus-fleet-memory-plugin',
});
const ALERT = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0003', sentAt: new Date('2026-10-31T19:54:00.000Z'), senderName: 'watch', contentType: 'application/vnd.aeolus.alert+json', payload: '{}', headline: 'builder-gateway: no report change for 2 h' });
const NOTICE = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0004', sentAt: new Date('2026-10-31T19:51:00.000Z'), senderName: 'design-command-center', contentType: 'application/vnd.aeolus.notice+json', payload: '{}', headline: 'PR #1497 opened: Bridge mockups' });
const TEXT = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0005', contentType: 'text/plain', payload: 'Thanks', headline: null });

/** A question from commercial that Charlotte opened in Bridge and has not answered. */
function anOpened(overrides: Partial<OpenedDelivery> = {}): OpenedDelivery {
  return {
    fleetId: FLEET_ID,
    shipId: PERSON_SHIP_ID,
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0009',
    messageId: 'msg_01m3tbfspe96yf1rnr4ank0009',
    senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9com',
    from: 'commercial',
    title: 'Pricing page: a price per ship, or plans only?',
    contentType: 'application/vnd.aeolus.question+json',
    askedQuestionId: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b',
    withdrawnQuestionId: null,
    stepId: null,
    withdrawnStepId: null,
    sentAt: new Date('2026-10-31T19:20:00.000Z'),
    openedAt: new Date('2026-10-31T19:30:00.000Z'),
    ...overrides,
  };
}

describe('Bridge home: what waits on the person, with one count (CC18)', () => {
  it('lists the questions and steps that wait, newest first, and counts them', async () => {
    const home = await readHome([STEP, QUESTION]).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? { count: home.value.waiting.count, items: home.value.waiting.items.map(({ title, job, state }) => ({ title, job, state })) } : home).toEqual({
      count: 2,
      items: [
        { title: 'Which goes first: the Compact look (U4) or Harbour?', job: 'decide', state: 'new' },
        { title: 'Create the GitHub repository aeolus-fleet-memory-plugin', job: 'do', state: 'new' },
      ],
    });
  });

  it('lists and counts every question that waits, however many, not only the first 10', async () => {
    const questions = Array.from({ length: 12 }, (_, index) => {
      const number = String(index + 1).padStart(4, '0');
      return aPersonDelivery({ deliveryId: `dlv_01m3tbfspe96yf1rnr4ank${number}`, messageId: `msg_01m3tbfspe96yf1rnr4ank${number}` });
    });

    const home = await readHome(questions).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? { count: home.value.waiting.count, listed: home.value.waiting.items.length } : home).toEqual({ count: 12, listed: 12 });
  });

  it('lists a question the person opened and has not answered as seen, still in the count', async () => {
    await opened.save(anOpened());

    const home = await readHome([QUESTION]).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? { count: home.value.waiting.count, items: home.value.waiting.items.map(({ from, state }) => ({ from, state })) } : home).toEqual({
      count: 2,
      items: [
        { from: 'orchestrator-1', state: 'new' },
        { from: 'commercial', state: 'seen' },
      ],
    });
  });

  it('says a question whose answer is in the basket is in it, with the option and the note, still waiting and in the count (section 9, rule 1)', async () => {
    await opened.save(anOpened());
    await entries.save(aBasketEntry({ questionId: anOpened().askedQuestionId ?? '', deliveryId: anOpened().deliveryId, option: 1, note: 'Plans only, for now.' }));

    const home = await readHome([QUESTION]).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? { count: home.value.waiting.count, items: home.value.waiting.items.map(({ from, inBasket }) => ({ from, inBasket })) } : home).toEqual({
      count: 2,
      items: [
        { from: 'orchestrator-1', inBasket: null },
        { from: 'commercial', inBasket: { option: 1, note: 'Plans only, for now.' } },
      ],
    });
  });

  it('counts a delivery opened before Bridge, whose content type the gateway did not keep, as one to decide: it waited then', async () => {
    await opened.save(anOpened({ contentType: null }));

    const home = await readHome([]).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? home.value.waiting.items.map(({ job }) => job) : home).toEqual(['decide']);
  });

  it('leaves an opened message that is neither a question nor a step out of what waits', async () => {
    await opened.save(anOpened({ contentType: 'text/plain' }));

    const home = await readHome([]).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? home.value.waiting : home).toEqual({ count: 0, items: [] });
  });

  it('puts the alerts and notices that reached the person in the stay-aware feed, newest first, outside the count', async () => {
    const home = await readHome([NOTICE, QUESTION, ALERT]).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? { count: home.value.waiting.count, stayAware: home.value.stayAware.map(({ title, from }) => ({ title, from })) } : home).toEqual({
      count: 1,
      stayAware: [
        { title: 'builder-gateway: no report change for 2 h', from: 'watch' },
        { title: 'PR #1497 opened: Bridge mockups', from: 'design-command-center' },
      ],
    });
  });

  it('leaves everything else out of what waits and the feed: it is in the record', async () => {
    const home = await readHome([TEXT]).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? { waiting: home.value.waiting, stayAware: home.value.stayAware } : home).toEqual({ waiting: { count: 0, items: [] }, stayAware: [] });
  });

  it('takes nothing from the fleet while nothing waits there', async () => {
    const reading = readHome([]);

    await reading.readHome(CHARLOTTE_GRANT);

    expect(reading.calls).toEqual(['inbox']);
  });

  it('says the fleet did not answer when it cannot read what waits', async () => {
    const reading = readHome([QUESTION]);
    reading.refusals.pushReceive.push({ code: 'FLEET_UNREACHABLE', message: 'The fleet did not answer' });

    await expect(reading.readHome(CHARLOTTE_GRANT)).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});

describe('Bridge home: a question its asker withdrew or replaced (CC11, decision 0038)', () => {
  const ASKED = '9b2f6c1e-4a7d-4e0b-8c3f-2d5a6b7c8d9e';
  const ORCHESTRATOR = 'shp_01m3tbfspe96yf1rnr4ank0orc';
  const ASKING = aPersonDelivery({ ...QUESTION, senderShipId: ORCHESTRATOR, askedQuestionId: ASKED });
  const WITHDRAWAL = aPersonDelivery({
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0006',
    senderShipId: ORCHESTRATOR,
    senderName: 'orchestrator-1',
    contentType: 'application/vnd.aeolus.question-withdrawal+json',
    payload: JSON.stringify({ questionId: ASKED }),
    headline: null,
    askedQuestionId: null,
    withdrawnQuestionId: ASKED,
    sentAt: new Date('2026-10-31T20:09:00.000Z'),
  });
  const REPLACEMENT = aPersonDelivery({
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0007',
    senderShipId: ORCHESTRATOR,
    senderName: 'orchestrator-1',
    contentType: 'application/vnd.aeolus.question-replacement+json',
    headline: 'Which goes first, now that U4 slipped?',
    askedQuestionId: '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f',
    withdrawnQuestionId: ASKED,
    sentAt: new Date('2026-10-31T20:10:00.000Z'),
  });

  function shownOf(home: Awaited<ReturnType<ReturnType<typeof readHome>['readHome']>>) {
    return home.isOk ? { count: home.value.waiting.count, items: home.value.waiting.items.map(({ deliveryId, stale }) => ({ deliveryId, stale })) } : home;
  }

  it('shows a withdrawn question stale, out of the count, and leaves the withdrawal itself out', async () => {
    const home = await readHome([ASKING, WITHDRAWAL]).readHome(CHARLOTTE_GRANT);

    expect(shownOf(home)).toEqual({ count: 0, items: [{ deliveryId: QUESTION.deliveryId, stale: { kind: 'withdrawn', replacementId: null } }] });
  });

  it('shows a replaced question stale, out of the count, linked to its replacement, which waits as a new item', async () => {
    const home = await readHome([ASKING, REPLACEMENT]).readHome(CHARLOTTE_GRANT);

    expect(shownOf(home)).toEqual({
      count: 1,
      items: [
        { deliveryId: REPLACEMENT.deliveryId, stale: null },
        { deliveryId: QUESTION.deliveryId, stale: { kind: 'replaced', replacementId: REPLACEMENT.deliveryId } },
      ],
    });
  });

  it('shows a question the person opened stale once its asker withdraws it', async () => {
    await opened.save(anOpened({ deliveryId: QUESTION.deliveryId, senderShipId: ORCHESTRATOR, askedQuestionId: ASKED }));

    const home = await readHome([WITHDRAWAL]).readHome(CHARLOTTE_GRANT);

    expect(shownOf(home)).toEqual({ count: 0, items: [{ deliveryId: QUESTION.deliveryId, stale: { kind: 'withdrawn', replacementId: null } }] });
  });

  it('shows a question stale whose replacement the person opened already', async () => {
    await opened.save(anOpened({ deliveryId: REPLACEMENT.deliveryId, senderShipId: ORCHESTRATOR, askedQuestionId: REPLACEMENT.askedQuestionId, withdrawnQuestionId: ASKED, sentAt: REPLACEMENT.sentAt }));

    const home = await readHome([ASKING]).readHome(CHARLOTTE_GRANT);

    expect(shownOf(home)).toEqual({
      count: 1,
      items: [
        { deliveryId: REPLACEMENT.deliveryId, stale: null },
        { deliveryId: QUESTION.deliveryId, stale: { kind: 'replaced', replacementId: REPLACEMENT.deliveryId } },
      ],
    });
  });

  it('keeps a question waiting, in the count, when another ship names it: only its asker withdraws it', async () => {
    const home = await readHome([ASKING, { ...WITHDRAWAL, senderShipId: 'shp_01m3tbfspe96yf1rnr4ank0oth' }]).readHome(CHARLOTTE_GRANT);

    expect(shownOf(home)).toEqual({ count: 1, items: [{ deliveryId: QUESTION.deliveryId, stale: null }] });
  });
});

describe('Bridge home: a step its asker withdrew or replaced, as a question (CC14)', () => {
  const STEP_ID = '6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10';
  const ORCHESTRATOR = 'shp_01m3tbfspe96yf1rnr4ank0orc';
  const ASKING = aPersonDelivery({ ...STEP, senderShipId: ORCHESTRATOR, askedQuestionId: null, stepId: STEP_ID });
  const WITHDRAWAL = aPersonDelivery({
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0006',
    senderShipId: ORCHESTRATOR,
    senderName: 'orchestrator-1',
    contentType: 'application/vnd.aeolus.step-withdrawal+json',
    payload: JSON.stringify({ stepId: STEP_ID }),
    headline: null,
    askedQuestionId: null,
    withdrawnStepId: STEP_ID,
    sentAt: new Date('2026-10-31T20:09:00.000Z'),
  });
  const REPLACEMENT = aPersonDelivery({
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0007',
    senderShipId: ORCHESTRATOR,
    senderName: 'orchestrator-1',
    contentType: 'application/vnd.aeolus.step-replacement+json',
    headline: 'Create the GitHub repository aeolus-fleet-memory',
    askedQuestionId: null,
    stepId: '7a2d3b51-6e2c-4c9f-8b62-1d9f4a3b8e21',
    withdrawnStepId: STEP_ID,
    sentAt: new Date('2026-10-31T20:10:00.000Z'),
  });

  function shownOf(home: Awaited<ReturnType<ReturnType<typeof readHome>['readHome']>>) {
    return home.isOk ? { count: home.value.waiting.count, items: home.value.waiting.items.map(({ deliveryId, stale }) => ({ deliveryId, stale })) } : home;
  }

  it('shows a withdrawn step stale, out of the count, and leaves the withdrawal itself out', async () => {
    const home = await readHome([ASKING, WITHDRAWAL]).readHome(CHARLOTTE_GRANT);

    expect(shownOf(home)).toEqual({ count: 0, items: [{ deliveryId: STEP.deliveryId, stale: { kind: 'withdrawn', replacementId: null } }] });
  });

  it('shows a replaced step stale, out of the count, linked to its replacement, which waits as a new item', async () => {
    const home = await readHome([ASKING, REPLACEMENT]).readHome(CHARLOTTE_GRANT);

    expect(shownOf(home)).toEqual({
      count: 1,
      items: [
        { deliveryId: REPLACEMENT.deliveryId, stale: null },
        { deliveryId: STEP.deliveryId, stale: { kind: 'replaced', replacementId: REPLACEMENT.deliveryId } },
      ],
    });
  });

  it('shows a step the person opened stale once its asker withdraws it', async () => {
    await opened.save(anOpened({ deliveryId: STEP.deliveryId, senderShipId: ORCHESTRATOR, contentType: STEP.contentType, askedQuestionId: null, stepId: STEP_ID }));

    const home = await readHome([WITHDRAWAL]).readHome(CHARLOTTE_GRANT);

    expect(shownOf(home)).toEqual({ count: 0, items: [{ deliveryId: STEP.deliveryId, stale: { kind: 'withdrawn', replacementId: null } }] });
  });

  it('shows a step stale whose replacement the person opened already', async () => {
    await opened.save(anOpened({ deliveryId: REPLACEMENT.deliveryId, senderShipId: ORCHESTRATOR, contentType: REPLACEMENT.contentType, askedQuestionId: null, stepId: REPLACEMENT.stepId, withdrawnStepId: STEP_ID, sentAt: REPLACEMENT.sentAt }));

    const home = await readHome([ASKING]).readHome(CHARLOTTE_GRANT);

    expect(shownOf(home)).toEqual({
      count: 1,
      items: [
        { deliveryId: REPLACEMENT.deliveryId, stale: null },
        { deliveryId: STEP.deliveryId, stale: { kind: 'replaced', replacementId: REPLACEMENT.deliveryId } },
      ],
    });
  });

  it('keeps a step waiting, in the count, when another ship names it: only its asker withdraws it', async () => {
    const home = await readHome([ASKING, { ...WITHDRAWAL, senderShipId: 'shp_01m3tbfspe96yf1rnr4ank0oth' }]).readHome(CHARLOTTE_GRANT);

    expect(shownOf(home)).toEqual({ count: 1, items: [{ deliveryId: STEP.deliveryId, stale: null }] });
  });

  it('keeps a question waiting, in the count, when a step withdrawal names its uuid: a step withdrawal withdraws only a step', async () => {
    const question = aPersonDelivery({ ...QUESTION, senderShipId: ORCHESTRATOR, askedQuestionId: STEP_ID });

    const home = await readHome([question, WITHDRAWAL]).readHome(CHARLOTTE_GRANT);

    expect(shownOf(home)).toEqual({ count: 1, items: [{ deliveryId: QUESTION.deliveryId, stale: null }] });
  });
});
