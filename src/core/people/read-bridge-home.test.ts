import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { aBasketEntry, aPersonDelivery, CHARLOTTE_GRANT, fakeCrewPersonShip, fakePersonShipDoor, memoryBasketEntries, memoryInboxChanges, memoryItemOutcomes, memoryOpenedDeliveries, memoryPersonCrews, memoryRoutes, holding } from '../../../test/support/people-fakes.js';
import { memoryPartyStore } from '../../../test/support/party-fakes.js';
import { anAttioParty } from '../../../test/support/party-grant-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { OpenedDelivery, PersonDelivery } from './ports.js';
import type { RecordedPersonDelivery } from './ports.js';
import { createReadBridgeHome } from './read-bridge-home.js';
import { routingDefaultsOf, type Route } from './routing.js';
import { createStaleSightings } from './stale-sightings.js';

// Bridge home (docs/design/bridge, CC18): what waits on the person with one
// count, decide and do, and the stay-aware feed beside it, outside the count.

let crews: ReturnType<typeof memoryPersonCrews>;
let opened: ReturnType<typeof memoryOpenedDeliveries>;
let entries: ReturnType<typeof memoryBasketEntries>;
let connections: ReturnType<typeof memoryConnectionStore>;
let routes: Route[];
let outcomes: ReturnType<typeof memoryItemOutcomes>;
let parties: ReturnType<typeof memoryPartyStore>;
/** The gateway's clock, which a test moves on. */
let now: Date;

/** The gateway's own ship in the fleet, which sends the person its own steps (CC14). */
const GATEWAY_SHIP_ID = 'shp_01m3tbfspe96yf1rnr4ank0gat';

/** The gateway's defaults (CC19): a chat on for every job, Slack, web push and email off. */
const CHAT_ON = routingDefaultsOf([
  { job: 'decide', place: 'chat' },
  { job: 'do', place: 'chat' },
  { job: 'stay-aware', place: 'chat' },
  { job: 'everything-else', place: 'chat' },
]);

beforeEach(async () => {
  crews = memoryPersonCrews();
  opened = memoryOpenedDeliveries();
  entries = memoryBasketEntries();
  connections = memoryConnectionStore();
  routes = [];
  outcomes = memoryItemOutcomes();
  parties = memoryPartyStore();
  now = new Date('2026-10-31T20:10:00.000Z');
  await connections.save({ fleetId: FLEET_ID, shipId: GATEWAY_SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: new Date('2026-10-01T00:00:00.000Z') });
});

/** The party of the gateway's own step, by the step's link: its sign-in page's party. */
function ownStepPartyOf(href: string): string | undefined {
  return /\/outside-parties\/([^/?]+)/.exec(href)?.[1];
}

function readHome(deliveries: PersonDelivery[], options: { offered?: { isEmailOffered: boolean; isWebPushOffered: boolean }; record?: RecordedPersonDelivery[]; acknowledged?: PersonDelivery[] } = {}) {
  const { offered = { isEmailOffered: false, isWebPushOffered: true }, record = [], acknowledged = [] } = options;
  const ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries, record, acknowledged });
  return {
    ...ship,
    readHome: createReadBridgeHome({
      crewPersonShip: fakeCrewPersonShip(crews),
      crews,
      ...holding(ship.door),
      opened,
      entries,
      outcomes,
      changes: memoryInboxChanges(),
      clock: { now: () => now },
      sightings: createStaleSightings(),
      connections,
      routes: memoryRoutes(routes),
      defaults: CHAT_ON,
      parties,
      ownStepPartyOf,
      ...offered,
    }),
  };
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
    stepLink: null,
    openedIn: null,
    sentAt: new Date('2026-10-31T19:20:00.000Z'),
    openedAt: new Date('2026-10-31T19:30:00.000Z'),
    ...overrides,
  };
}

describe('Bridge home: what waits on the person, with one count (CC18)', () => {
  it.each([
    ['question context', { delivery: QUESTION, payload: { id: '6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10', title: 'Choose', context: '  The asker\'s words.\n' + 'More detail. '.repeat(100), options: [{ key: 1, label: 'Yes' }], pick: { option: 1, why: 'Ready' } }, reason: '  The asker\'s words.\n' + 'More detail. '.repeat(100) }],
    ['step why', { delivery: STEP, payload: { id: '6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10', title: 'Create', why: 'The build needs it.' }, reason: 'The build needs it.' }],
    ['neither', { delivery: STEP, payload: { id: '6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10', title: 'Create', why: '' }, reason: undefined }],
  ])('passes through the asker reason for %s, new and opened', async (_name, { delivery, payload, reason }) => {
    const asking = aPersonDelivery({ ...delivery, payload: JSON.stringify(payload) });
    const fresh = await readHome([asking]).readHome(CHARLOTTE_GRANT);
    await opened.save(anOpened({ deliveryId: asking.deliveryId, contentType: asking.contentType }));
    const seen = await readHome([], { acknowledged: [asking] }).readHome(CHARLOTTE_GRANT);

    for (const home of [fresh, seen]) {
      expect(home.isOk && home.value.waiting.items[0]).toEqual(expect.objectContaining(reason === undefined ? {} : { reason }));
      if (reason === undefined) expect(home.isOk && home.value.waiting.items[0]).not.toHaveProperty('reason');
    }
  });

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

  it('shows each of more than 10 deliveries sent the person ship, questions, a step, a notice and an alert, past the first 10 taken (aeolus-fleet#1583)', async () => {
    const questions = Array.from({ length: 10 }, (_, index) => {
      const number = String(index + 1).padStart(4, '0');
      return aPersonDelivery({ deliveryId: `dlv_01m3tbfspe96yf1rnr4ank${number}`, messageId: `msg_01m3tbfspe96yf1rnr4ank${number}` });
    });
    const later = [
      aPersonDelivery({ ...STEP, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0021', messageId: 'msg_01m3tbfspe96yf1rnr4ank0021' }),
      aPersonDelivery({ ...NOTICE, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0022', messageId: 'msg_01m3tbfspe96yf1rnr4ank0022' }),
      aPersonDelivery({ ...ALERT, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0023', messageId: 'msg_01m3tbfspe96yf1rnr4ank0023' }),
    ];

    const home = await readHome([...questions, ...later]).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? [...home.value.waiting.items, ...home.value.stayAware].map(({ deliveryId }) => deliveryId).sort() : home).toEqual([
      ...questions.map(({ deliveryId }) => deliveryId),
      'dlv_01m3tbfspe96yf1rnr4ank0021',
      'dlv_01m3tbfspe96yf1rnr4ank0022',
      'dlv_01m3tbfspe96yf1rnr4ank0023',
    ]);
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

  it("lists a meeting's added, mic and ended notices nowhere: not waiting, not stay-aware, not a message", async () => {
    const notices = ['added', 'mic', 'ended'].map((kind, index) =>
      aPersonDelivery({ deliveryId: `dlv_01m3tbfspe96yf1rnr4ank003${String(index)}`, contentType: `application/vnd.aeolus.meeting.${kind}+json`, payload: '{"meetingId":"mtg_01m5qa5j85mgd4z61d9c2k4mtg"}', headline: null, meetingId: 'mtg_01m5qa5j85mgd4z61d9c2k4mtg' }),
    );

    const home = await readHome(notices).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? { waiting: home.value.waiting.items, stayAware: home.value.stayAware, messages: home.value.messages } : home).toEqual({ waiting: [], stayAware: [], messages: [] });
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

    expect(reading.calls).toEqual(['inbox', 'record(newest)']);
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

    expect(shownOf(home)).toEqual({ count: 0, items: [{ deliveryId: QUESTION.deliveryId, stale: { kind: 'withdrawn', replacementId: null, at: WITHDRAWAL.sentAt.toISOString(), replacementTitle: null } }] });
  });

  it('shows a replaced question stale, out of the count, linked to its replacement, which waits as a new item', async () => {
    const home = await readHome([ASKING, REPLACEMENT]).readHome(CHARLOTTE_GRANT);

    expect(shownOf(home)).toEqual({
      count: 1,
      items: [
        { deliveryId: REPLACEMENT.deliveryId, stale: null },
        { deliveryId: QUESTION.deliveryId, stale: { kind: 'replaced', replacementId: REPLACEMENT.deliveryId, at: REPLACEMENT.sentAt.toISOString(), replacementTitle: REPLACEMENT.headline } },
      ],
    });
  });

  it('shows a question the person opened stale once its asker withdraws it', async () => {
    await opened.save(anOpened({ deliveryId: QUESTION.deliveryId, senderShipId: ORCHESTRATOR, askedQuestionId: ASKED }));

    const home = await readHome([WITHDRAWAL]).readHome(CHARLOTTE_GRANT);

    expect(shownOf(home)).toEqual({ count: 0, items: [{ deliveryId: QUESTION.deliveryId, stale: { kind: 'withdrawn', replacementId: null, at: WITHDRAWAL.sentAt.toISOString(), replacementTitle: null } }] });
  });

  it('shows a question stale whose replacement the person opened already', async () => {
    await opened.save(anOpened({ deliveryId: REPLACEMENT.deliveryId, senderShipId: ORCHESTRATOR, title: 'Which goes first, now that U4 slipped?', askedQuestionId: REPLACEMENT.askedQuestionId, withdrawnQuestionId: ASKED, sentAt: REPLACEMENT.sentAt }));

    const home = await readHome([ASKING]).readHome(CHARLOTTE_GRANT);

    expect(shownOf(home)).toEqual({
      count: 1,
      items: [
        { deliveryId: REPLACEMENT.deliveryId, stale: null },
        { deliveryId: QUESTION.deliveryId, stale: { kind: 'replaced', replacementId: REPLACEMENT.deliveryId, at: REPLACEMENT.sentAt.toISOString(), replacementTitle: REPLACEMENT.headline } },
      ],
    });
  });

  it('lists a withdrawn question until 5 s after Bridge first saw it withdrawn (#240)', async () => {
    const reading = readHome([ASKING, WITHDRAWAL]);
    await reading.readHome(CHARLOTTE_GRANT);
    now = new Date(now.getTime() + 4999);

    const home = await reading.readHome(CHARLOTTE_GRANT);

    expect(shownOf(home)).toMatchObject({ count: 0, items: [{ deliveryId: QUESTION.deliveryId }] });
  });

  it('ends a withdrawn question 5 s after Bridge first saw it withdrawn: gone from the list, done as withdrawn by the gateway, its withdrawal seen (#240)', async () => {
    const reading = readHome([ASKING, WITHDRAWAL]);
    await reading.readHome(CHARLOTTE_GRANT);
    now = new Date(now.getTime() + 5000);

    const home = await reading.readHome(CHARLOTTE_GRANT);

    expect({ shown: shownOf(home), outcomes: outcomes.held.map(({ deliveryId, place, kind, seen }) => ({ deliveryId, place, kind, seen })), handled: reading.calls.filter((call) => call.startsWith('handled')) }).toEqual({
      shown: { count: 0, items: [] },
      outcomes: [
        { deliveryId: QUESTION.deliveryId, place: 'gateway', kind: 'withdrawn', seen: null },
        { deliveryId: WITHDRAWAL.deliveryId, place: 'gateway', kind: 'seen', seen: { place: 'gateway', at: now } },
      ],
      handled: [`handled(${QUESTION.deliveryId})`, `handled(${WITHDRAWAL.deliveryId})`],
    });
  });

  it('ends a replaced question 5 s after Bridge first saw it replaced, and keeps its replacement waiting (#240)', async () => {
    const reading = readHome([ASKING, REPLACEMENT]);
    await reading.readHome(CHARLOTTE_GRANT);
    now = new Date(now.getTime() + 5000);

    const home = await reading.readHome(CHARLOTTE_GRANT);

    expect({ shown: shownOf(home), outcomes: outcomes.held.map(({ deliveryId, place, kind }) => ({ deliveryId, place, kind })) }).toEqual({
      shown: { count: 1, items: [{ deliveryId: REPLACEMENT.deliveryId, stale: null }] },
      outcomes: [{ deliveryId: QUESTION.deliveryId, place: 'gateway', kind: 'replaced' }],
    });
  });

  it('ends a question the person opened, 5 s after Bridge first saw it withdrawn, still saying where they saw it (#240)', async () => {
    await opened.save(anOpened({ deliveryId: QUESTION.deliveryId, senderShipId: ORCHESTRATOR, askedQuestionId: ASKED, openedIn: 'bridge' }));
    const reading = readHome([WITHDRAWAL]);
    await reading.readHome(CHARLOTTE_GRANT);
    now = new Date(now.getTime() + 5000);

    const home = await reading.readHome(CHARLOTTE_GRANT);

    expect({ shown: shownOf(home), outcome: outcomes.held.find(({ deliveryId }) => deliveryId === QUESTION.deliveryId) }).toMatchObject({
      shown: { count: 0, items: [] },
      outcome: { place: 'gateway', kind: 'withdrawn', seen: { place: 'bridge' } },
    });
  });

  it('counts the 5 s from when Bridge first saw it withdrawn, not from when the withdrawal was sent (#240)', async () => {
    now = new Date(WITHDRAWAL.sentAt.getTime() + 60_000);

    const home = await readHome([ASKING, WITHDRAWAL]).readHome(CHARLOTTE_GRANT);

    expect(shownOf(home)).toMatchObject({ count: 0, items: [{ deliveryId: QUESTION.deliveryId }] });
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

    expect(shownOf(home)).toEqual({ count: 0, items: [{ deliveryId: STEP.deliveryId, stale: { kind: 'withdrawn', replacementId: null, at: WITHDRAWAL.sentAt.toISOString(), replacementTitle: null } }] });
  });

  it('shows a replaced step stale, out of the count, linked to its replacement, which waits as a new item', async () => {
    const home = await readHome([ASKING, REPLACEMENT]).readHome(CHARLOTTE_GRANT);

    expect(shownOf(home)).toEqual({
      count: 1,
      items: [
        { deliveryId: REPLACEMENT.deliveryId, stale: null },
        { deliveryId: STEP.deliveryId, stale: { kind: 'replaced', replacementId: REPLACEMENT.deliveryId, at: REPLACEMENT.sentAt.toISOString(), replacementTitle: REPLACEMENT.headline } },
      ],
    });
  });

  it('shows a step the person opened stale once its asker withdraws it', async () => {
    await opened.save(anOpened({ deliveryId: STEP.deliveryId, senderShipId: ORCHESTRATOR, contentType: STEP.contentType, askedQuestionId: null, stepId: STEP_ID }));

    const home = await readHome([WITHDRAWAL]).readHome(CHARLOTTE_GRANT);

    expect(shownOf(home)).toEqual({ count: 0, items: [{ deliveryId: STEP.deliveryId, stale: { kind: 'withdrawn', replacementId: null, at: WITHDRAWAL.sentAt.toISOString(), replacementTitle: null } }] });
  });

  it('shows a step stale whose replacement the person opened already', async () => {
    await opened.save(anOpened({ deliveryId: REPLACEMENT.deliveryId, senderShipId: ORCHESTRATOR, title: 'Create the GitHub repository aeolus-fleet-memory', contentType: REPLACEMENT.contentType, askedQuestionId: null, stepId: REPLACEMENT.stepId, withdrawnStepId: STEP_ID, sentAt: REPLACEMENT.sentAt }));

    const home = await readHome([ASKING]).readHome(CHARLOTTE_GRANT);

    expect(shownOf(home)).toEqual({
      count: 1,
      items: [
        { deliveryId: REPLACEMENT.deliveryId, stale: null },
        { deliveryId: STEP.deliveryId, stale: { kind: 'replaced', replacementId: REPLACEMENT.deliveryId, at: REPLACEMENT.sentAt.toISOString(), replacementTitle: REPLACEMENT.headline } },
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

describe('Bridge home: what each row says and acts on in place (aeolus-fleet#1535)', () => {
  const PICKED = aPersonDelivery({
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0010',
    senderName: 'orchestrator-1',
    headline: 'Which goes first: the Compact look (U4) or Harbour?',
    askedQuestionId: '7d1e2f3a-4b5c-4d6e-8f7a-9b0c1d2e3f4a',
    pick: 2,
  });
  const LINKED_STEP = aPersonDelivery({ ...STEP, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0011', stepId: '6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10', stepLink: 'https://github.com/new', askedQuestionId: null });
  const OWN_STEP = aPersonDelivery({
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0012',
    senderShipId: GATEWAY_SHIP_ID,
    senderName: 'gateway',
    contentType: 'application/vnd.aeolus.step+json',
    headline: 'Sign in to the outside party linear',
    askedQuestionId: null,
    stepId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    stepLink: 'https://gateway.example.com/outside-parties/linear?fleet=flt_1',
  });

  function actsOf(home: Awaited<ReturnType<ReturnType<typeof readHome>['readHome']>>) {
    return home.isOk ? home.value.waiting.items.map(({ deliveryId, actInPlace }) => ({ deliveryId, actInPlace })) : home;
  }

  it('offers to put the asker\'s pick in the basket on a question still new', async () => {
    const home = await readHome([PICKED]).readHome(CHARLOTTE_GRANT);

    expect(actsOf(home)).toEqual([{ deliveryId: PICKED.deliveryId, actInPlace: { kind: 'putPick', option: 2 } }]);
  });

  it('offers nothing in place on a question the person opened: they answer it opened', async () => {
    await opened.save(anOpened());

    const home = await readHome([]).readHome(CHARLOTTE_GRANT);

    expect(actsOf(home)).toEqual([{ deliveryId: anOpened().deliveryId, actInPlace: null }]);
  });

  it('offers nothing in place on a question its asker withdrew', async () => {
    const withdrawal = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0013', senderShipId: PICKED.senderShipId, contentType: 'application/vnd.aeolus.question-withdrawal+json', headline: null, askedQuestionId: null, withdrawnQuestionId: PICKED.askedQuestionId });

    const home = await readHome([PICKED, withdrawal]).readHome(CHARLOTTE_GRANT);

    expect(actsOf(home)).toEqual([{ deliveryId: PICKED.deliveryId, actInPlace: null }]);
  });

  it('offers a step\'s link with the host it leads to', async () => {
    const home = await readHome([LINKED_STEP]).readHome(CHARLOTTE_GRANT);

    expect(actsOf(home)).toEqual([{ deliveryId: LINKED_STEP.deliveryId, actInPlace: { kind: 'openLink', href: 'https://github.com/new', host: 'github.com' } }]);
  });

  it('offers a step\'s link once the person opened it, as kept on opening', async () => {
    await opened.save(anOpened({ contentType: 'application/vnd.aeolus.step+json', askedQuestionId: null, stepId: '6f1c2a40-5d1b-4b8e-9a51-0c8e3f2a7d10', stepLink: 'https://github.com/new' }));

    const home = await readHome([]).readHome(CHARLOTTE_GRANT);

    expect(actsOf(home)).toEqual([{ deliveryId: anOpened().deliveryId, actInPlace: { kind: 'openLink', href: 'https://github.com/new', host: 'github.com' } }]);
  });

  it('offers nothing in place on a step its asker withdrew', async () => {
    const withdrawal = aPersonDelivery({
      deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0014',
      senderShipId: LINKED_STEP.senderShipId,
      contentType: 'application/vnd.aeolus.step-withdrawal+json',
      payload: JSON.stringify({ stepId: LINKED_STEP.stepId }),
      headline: null,
      askedQuestionId: null,
      stepId: null,
      withdrawnStepId: LINKED_STEP.stepId,
    });

    const home = await readHome([LINKED_STEP, withdrawal]).readHome(CHARLOTTE_GRANT);

    expect(actsOf(home)).toEqual([{ deliveryId: LINKED_STEP.deliveryId, actInPlace: null }]);
  });

  it('offers nothing in place on a step with no link', async () => {
    const home = await readHome([STEP]).readHome(CHARLOTTE_GRANT);

    expect(actsOf(home)).toEqual([{ deliveryId: STEP.deliveryId, actInPlace: null }]);
  });

  it('offers the gateway\'s own step as its own action, in the gateway\'s words, where it is done', async () => {
    const home = await readHome([OWN_STEP]).readHome(CHARLOTTE_GRANT);

    expect(actsOf(home)).toEqual([{ deliveryId: OWN_STEP.deliveryId, actInPlace: { kind: 'ownStep', href: 'https://gateway.example.com/outside-parties/linear?fleet=flt_1', label: 'Sign in to linear' } }]);
  });

  it("says Sign in to the party's server's own title, when the gateway keeps one (aeolus-fleet#1535)", async () => {
    await parties.save(anAttioParty({ name: 'linear', displayName: 'Linear' }));

    const home = await readHome([OWN_STEP]).readHome(CHARLOTTE_GRANT);

    expect(actsOf(home)).toEqual([{ deliveryId: OWN_STEP.deliveryId, actInPlace: { kind: 'ownStep', href: 'https://gateway.example.com/outside-parties/linear?fleet=flt_1', label: 'Sign in to Linear' } }]);
  });

  it('offers the gateway\'s own step by its title when the gateway has no words of its own for it', async () => {
    const linkSlack = aPersonDelivery({ ...OWN_STEP, headline: 'Link Slack', stepLink: 'https://gateway.example.com/slack/link?fleet=flt_1' });

    const home = await readHome([linkSlack]).readHome(CHARLOTTE_GRANT);

    expect(actsOf(home)).toEqual([{ deliveryId: OWN_STEP.deliveryId, actInPlace: { kind: 'ownStep', href: 'https://gateway.example.com/slack/link?fleet=flt_1', label: 'Link Slack' } }]);
  });

  it('names no place besides Bridge for the gateway\'s own step: a chat and Slack never show it (BH8)', async () => {
    const home = await readHome([OWN_STEP, LINKED_STEP]).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? home.value.waiting.items.map(({ from, places }) => ({ from, places })) : home).toEqual([
      { from: 'orchestrator-1', places: ['chat'] },
      { from: 'gateway', places: [] },
    ]);
  });

  it('says where the person saw an item they opened', async () => {
    await opened.save(anOpened({ openedIn: 'bridge' }));

    const home = await readHome([]).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? home.value.waiting.items.map(({ state, seenIn }) => ({ state, seenIn })) : home).toEqual([{ state: 'seen', seenIn: 'bridge' }]);
  });

  it('says nowhere for an item opened before the gateway kept where', async () => {
    await opened.save(anOpened());

    const home = await readHome([]).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? home.value.waiting.items.map(({ seenIn }) => seenIn) : home).toEqual([null]);
  });

  it('keeps the alerts and notices seen on the record\'s newest page in the feed, done, with where they were seen, among the unseen newest first', async () => {
    const seenNotice: RecordedPersonDelivery = { ...NOTICE, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0020', sentAt: new Date('2026-10-31T19:52:00.000Z'), state: 'handled', isPayloadUnreadable: false };
    const answered: RecordedPersonDelivery = { ...QUESTION, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0021', state: 'handled', isPayloadUnreadable: false };
    await outcomes.save({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, deliveryId: seenNotice.deliveryId, place: 'bridge', kind: 'seen', option: null, at: new Date('2026-10-31T19:53:00.000Z') });

    const home = await readHome([ALERT, NOTICE], { record: [{ ...ALERT, state: 'received', isPayloadUnreadable: false }, { ...NOTICE, state: 'received', isPayloadUnreadable: false }, seenNotice, answered] }).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? home.value.stayAware.map(({ deliveryId, state, seenIn }) => ({ deliveryId, state, seenIn })) : home).toEqual([
      { deliveryId: ALERT.deliveryId, state: 'new', seenIn: null },
      { deliveryId: seenNotice.deliveryId, state: 'done', seenIn: 'bridge' },
      { deliveryId: NOTICE.deliveryId, state: 'new', seenIn: null },
    ]);
  });

  it('says the record cannot be read when the fleet does not answer for it', async () => {
    const reading = readHome([QUESTION]);
    reading.refusals.record.push({ code: 'FLEET_UNREACHABLE', message: 'The fleet did not answer' });

    await expect(reading.readHome(CHARLOTTE_GRANT)).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });

  it('tells an alert from a notice in the stay-aware feed', async () => {
    const home = await readHome([NOTICE, ALERT]).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? home.value.stayAware.map(({ title, isAlert }) => ({ title, isAlert })) : home).toEqual([
      { title: 'builder-gateway: no report change for 2 h', isAlert: true },
      { title: 'PR #1497 opened: Bridge mockups', isAlert: false },
    ]);
  });

  it('names the places besides Bridge that show each item: a chat by default', async () => {
    const home = await readHome([QUESTION, ALERT]).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? [...home.value.waiting.items, ...home.value.stayAware].map(({ places }) => places) : home).toEqual([['chat'], ['chat']]);
  });

  it('names a place that pushes only on what arrived after it was turned on for the job (CC20)', async () => {
    routes.push({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, job: 'decide', place: 'slack', isOn: true, changedAt: new Date('2026-10-31T19:30:00.000Z') });
    await opened.save(anOpened());

    const home = await readHome([QUESTION]).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? home.value.waiting.items.map(({ from, places }) => ({ from, places })) : home).toEqual([
      { from: 'orchestrator-1', places: ['slack', 'chat'] },
      { from: 'commercial', places: ['chat'] },
    ]);
  });

  it('names no place the gateway does not offer, though turned on', async () => {
    routes.push({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, job: 'stay-aware', place: 'web-push', isOn: true, changedAt: new Date('2026-10-01T00:00:00.000Z') });

    const home = await readHome([ALERT], { offered: { isEmailOffered: false, isWebPushOffered: false } }).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? home.value.stayAware.map(({ places }) => places) : home).toEqual([['chat']]);
  });
});

describe('Bridge home: plain messages to the person (#242)', () => {
  const MESSAGE = aPersonDelivery({
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0011',
    sentAt: new Date('2026-10-31T19:52:00.000Z'),
    senderName: 'builder-core',
    contentType: 'text/markdown; charset=utf-8',
    payload: '# Staging is green again after the migration\n\nThe 0.38 migration ran on staging at 19:52 and every Testcontainers suite passes.',
    headline: null,
  });
  const PLAIN = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0012', sentAt: new Date('2026-10-31T19:00:00.000Z'), senderName: 'design-bridge-201', contentType: 'text/plain', payload: 'Thanks: the basket sheet is merged', headline: null });
  const SEEN = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0013', sentAt: new Date('2026-10-31T18:00:00.000Z'), senderName: 'design-bridge-201', contentType: 'text/plain', payload: 'PR #203 is in\nThe Send button sits beside "Put option N in the basket".', headline: null });

  function messagesOf(home: Awaited<ReturnType<ReturnType<typeof readHome>['readHome']>>) {
    return home.isOk ? home.value.messages.map(({ deliveryId, title, excerpt, state, from, job }) => ({ deliveryId, title, excerpt, state, from, job })) : home;
  }

  it('lists a text/markdown or text/plain message to the person, newest first, with its first line as title and the text after it, outside the count', async () => {
    const home = await readHome([PLAIN, MESSAGE, QUESTION]).readHome(CHARLOTTE_GRANT);

    expect({ messages: messagesOf(home), count: home.isOk ? home.value.waiting.count : home }).toEqual({
      messages: [
        { deliveryId: MESSAGE.deliveryId, title: '# Staging is green again after the migration', excerpt: 'The 0.38 migration ran on staging at 19:52 and every Testcontainers suite passes.', state: 'new', from: 'builder-core', job: 'everything-else' },
        { deliveryId: PLAIN.deliveryId, title: 'Thanks: the basket sheet is merged', excerpt: '', state: 'new', from: 'design-bridge-201', job: 'everything-else' },
      ],
      count: 1,
    });
  });

  it('lists a message the person opened as seen, its text read again from the fleet', async () => {
    await opened.save(anOpened({ deliveryId: SEEN.deliveryId, from: 'design-bridge-201', title: 'PR #203 is in', contentType: 'text/plain', askedQuestionId: null, openedIn: 'bridge', sentAt: SEEN.sentAt }));
    const reading = readHome([], { acknowledged: [SEEN] });

    const home = await reading.readHome(CHARLOTTE_GRANT);

    expect(messagesOf(home)).toEqual([{ deliveryId: SEEN.deliveryId, title: 'PR #203 is in', excerpt: 'The Send button sits beside "Put option N in the basket".', state: 'seen', from: 'design-bridge-201', job: 'everything-else' }]);
  });

  it('lists no other message the record only keeps, such as a withdrawal or an answer in a thread', async () => {
    const home = await readHome([aPersonDelivery({ ...TEXT, contentType: 'application/json' })]).readHome(CHARLOTTE_GRANT);

    expect(messagesOf(home)).toEqual([]);
  });

  it('cuts the text it lists after its first line, so the payload never travels whole', async () => {
    const long = aPersonDelivery({ ...PLAIN, payload: `Title\n${'a'.repeat(1000)}` });

    const home = await readHome([long]).readHome(CHARLOTTE_GRANT);

    expect(home.isOk ? home.value.messages[0]?.excerpt.length : home).toBe(280);
  });
});
