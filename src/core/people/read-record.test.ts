import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { aPersonDelivery, CHARLOTTE_GRANT, fakeCrewPersonShip, fakePersonShipDoor, memoryItemOutcomes, memoryPersonCrews, memoryRoutes } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { RecordedPersonDelivery } from './ports.js';
import { createReadRecord, RECORD_PAGE_SIZE } from './read-record.js';
import { routingDefaultsOf, type Route } from './routing.js';

// Done (docs/design/bridge, CC4, CC12): the person ship's record as core
// keeps it, newest first, only what is done (BH3), each item with what
// came of it and where, its places and where it was seen, so it reads back
// whole.

let crews: ReturnType<typeof memoryPersonCrews>;
let outcomes: ReturnType<typeof memoryItemOutcomes>;
let connections: ReturnType<typeof memoryConnectionStore>;
let routes: Route[];

beforeEach(() => {
  crews = memoryPersonCrews();
  outcomes = memoryItemOutcomes();
  connections = memoryConnectionStore();
  routes = [];
});

/** The gateway's defaults (CC19): a chat on for every job. */
const CHAT_ON = routingDefaultsOf([
  { job: 'decide', place: 'chat' },
  { job: 'do', place: 'chat' },
  { job: 'stay-aware', place: 'chat' },
  { job: 'everything-else', place: 'chat' },
]);

const QUESTION_ID = '0b9a7c1e-2f3d-4a5b-8c6d-7e8f9a0b1c2d';
const HARBOUR = JSON.stringify({
  id: QUESTION_ID,
  title: 'Which goes first: the Compact look (U4) or Harbour?',
  context: 'Both are approved.',
  options: [
    { key: 1, label: 'Compact first (U4), then Harbour' },
    { key: 2, label: 'Harbour first, on today\'s look' },
  ],
  pick: { option: 1, why: 'Harbour is drawn on Compact already.' },
});

function aRecorded(id: number, overrides: Partial<RecordedPersonDelivery> = {}): RecordedPersonDelivery {
  const suffix = String(id).padStart(4, '0');
  return { ...aPersonDelivery({ deliveryId: `dlv_01m3tbfspe96yf1rnr4ank${suffix}`, messageId: `msg_01m3tbfspe96yf1rnr4ank${suffix}` }), state: 'handled', isPayloadUnreadable: false, ...overrides };
}

function readRecord(record: RecordedPersonDelivery[]) {
  const ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [], record });
  return { ...ship, readRecord: createReadRecord({ crewPersonShip: fakeCrewPersonShip(crews), crews, door: ship.door, outcomes, connections, routes: memoryRoutes(routes), defaults: CHAT_ON, isEmailOffered: false, isWebPushOffered: false }) };
}

async function itemsOf(record: RecordedPersonDelivery[]) {
  const page = await readRecord(record).readRecord({ caller: CHARLOTTE_GRANT, cursor: null });
  if (!page.isOk) {
    throw new Error(page.error.message);
  }
  return page.value.items;
}

/** Keeps what came of a delivery of Charlotte's person ship. */
async function kept(deliveryId: string, outcome: { place: 'bridge' | 'chat' | 'slack' | 'gateway'; kind: 'seen' | 'answered' | 'done' | 'cannot' | 'withdrawn' | 'replaced' | 'notSent'; option?: number; note?: string; seen?: { place: 'bridge' | 'chat' | 'slack'; at: Date }; at: Date }) {
  await outcomes.save({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, deliveryId: `dlv_01m3tbfspe96yf1rnr4ank${deliveryId}`, option: null, ...outcome });
}

describe("a person reads their person ship's record in Done (Bridge, CC12)", () => {
  it('lists each done item newest first with who sent it, its title, its job and when it was sent', async () => {
    const items = await itemsOf([aRecorded(1), aRecorded(2, { contentType: 'application/vnd.aeolus.notice+json', payload: '{"headline":"core 0.42.0 is out","body":""}', headline: 'core 0.42.0 is out', senderName: 'builder-core' })]);

    expect(items.map(({ deliveryId, from, title, job, sentAt }) => ({ deliveryId, from, title, job, sentAt }))).toEqual([
      { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', from: 'builder-core', title: 'core 0.42.0 is out', job: 'stay-aware', sentAt: '2026-10-19T08:00:00.000Z' },
      { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', from: 'tracker', title: 'Go for release 1.4?', job: 'decide', sentAt: '2026-10-19T08:00:00.000Z' },
    ]);
  });

  it('leaves out what still waits on the person, new or seen: Done holds only items with an outcome (BH3)', async () => {
    const items = await itemsOf([aRecorded(1, { state: 'pending' }), aRecorded(2, { state: 'handed' }), aRecorded(3, { state: 'acknowledged' }), aRecorded(4, { state: 'handled' }), aRecorded(5, { state: 'undeliverable' })]);

    expect(items.map(({ deliveryId }) => deliveryId)).toEqual(['dlv_01m3tbfspe96yf1rnr4ank0004', 'dlv_01m3tbfspe96yf1rnr4ank0005']);
  });

  it('lists no withdrawal as an item of its own: it shows on the question or step it names', async () => {
    const withdrawal = aRecorded(2, { contentType: 'application/vnd.aeolus.question-withdrawal+json', payload: `{"questionId":"${QUESTION_ID}"}`, headline: null, askedQuestionId: null, withdrawnQuestionId: QUESTION_ID });
    const stepWithdrawal = aRecorded(3, { contentType: 'application/vnd.aeolus.step-withdrawal+json', payload: '{"stepId":"6f1c"}', headline: null, askedQuestionId: null, withdrawnStepId: '6f1c' });

    const items = await itemsOf([aRecorded(1, { askedQuestionId: QUESTION_ID }), withdrawal, stepWithdrawal]);

    expect(items.map(({ deliveryId }) => deliveryId)).toEqual(['dlv_01m3tbfspe96yf1rnr4ank0001']);
  });

  it("says the answer's option by its label, and quotes the note the person sent with it", async () => {
    await kept('0001', { place: 'slack', kind: 'answered', option: 2, note: 'The demo needs it.', at: new Date('2026-10-31T19:58:00.000Z') });

    const [item] = await itemsOf([aRecorded(1, { payload: HARBOUR, askedQuestionId: QUESTION_ID })]);

    expect(item?.outcome).toMatchObject({ place: 'slack', kind: 'answered', option: 2, optionLabel: "Harbour first, on today's look", note: 'The demo needs it.', at: '2026-10-31T19:58:00.000Z' });
  });

  it("says no option's label for an option the question does not have, or a payload that is no question", async () => {
    await kept('0001', { place: 'bridge', kind: 'answered', option: 3, at: new Date('2026-10-31T19:58:00.000Z') });
    await kept('0002', { place: 'bridge', kind: 'answered', option: 1, at: new Date('2026-10-31T19:58:00.000Z') });

    const items = await itemsOf([aRecorded(2, { payload: 'not json' }), aRecorded(1, { payload: HARBOUR, askedQuestionId: QUESTION_ID })]);

    expect(items.map(({ outcome }) => outcome?.optionLabel)).toEqual([null, null]);
  });

  it('says where and when the person saw it before what came of it', async () => {
    await kept('0001', { place: 'slack', kind: 'answered', option: 2, seen: { place: 'slack', at: new Date('2026-10-31T19:57:00.000Z') }, at: new Date('2026-10-31T19:58:00.000Z') });

    const [item] = await itemsOf([aRecorded(1)]);

    expect(item?.outcome?.seen).toEqual({ place: 'slack', at: '2026-10-31T19:57:00.000Z' });
  });

  it("names a replaced question's replacement by its title, from the record", async () => {
    await kept('0001', { place: 'bridge', kind: 'replaced', at: new Date('2026-10-31T11:40:00.000Z') });
    const replacement = aRecorded(2, {
      state: 'pending',
      contentType: 'application/vnd.aeolus.question-replacement+json',
      headline: 'Release core 0.42.0 after #1488?',
      askedQuestionId: '5d6e7f80-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
      withdrawnQuestionId: QUESTION_ID,
    });

    const [item] = await itemsOf([aRecorded(1, { askedQuestionId: QUESTION_ID, headline: 'Release core 0.42.0 today?' }), replacement]);

    expect(item?.outcome).toMatchObject({ kind: 'replaced', replacementTitle: 'Release core 0.42.0 after #1488?' });
  });

  it('says no replacement title for one its asker withdrew, or whose replacement is not on the page', async () => {
    await kept('0001', { place: 'bridge', kind: 'withdrawn', at: new Date('2026-10-31T11:40:00.000Z') });
    await kept('0003', { place: 'bridge', kind: 'replaced', at: new Date('2026-10-31T11:40:00.000Z') });

    const items = await itemsOf([aRecorded(1), aRecorded(3, { askedQuestionId: '7a7a7a7a-1a2b-4c3d-8e9f-0a1b2c3d4e5f' })]);

    expect(items.map(({ outcome }) => outcome?.replacementTitle)).toEqual([null, null]);
  });

  it("keeps another person ship's outcome out of the record", async () => {
    await outcomes.save({ fleetId: FLEET_ID, shipId: 'shp_01m3tbfspe96yf1rnr4ank0oth', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', place: 'bridge', kind: 'seen', option: null, at: new Date('2026-10-31T19:58:00.000Z') });

    const items = await itemsOf([aRecorded(1)]);

    expect(items.map(({ outcome }) => outcome)).toEqual([null]);
  });

  it('names the places besides Bridge that showed each item, as routing per job has them', async () => {
    routes.push({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, job: 'decide', place: 'slack', isOn: true, changedAt: new Date('2026-10-01T00:00:00.000Z') });

    const items = await itemsOf([aRecorded(1), aRecorded(2, { contentType: 'text/plain', payload: 'Thanks', headline: null })]);

    expect(items.map(({ places }) => places)).toEqual([['slack', 'chat'], ['chat']]);
  });

  it('tells an alert from a notice', async () => {
    const items = await itemsOf([aRecorded(1, { contentType: 'application/vnd.aeolus.alert+json', payload: '{}' }), aRecorded(2, { contentType: 'application/vnd.aeolus.notice+json', payload: '{}' })]);

    expect(items.map(({ isAlert }) => isAlert)).toEqual([true, false]);
  });

  it('carries what the item says, so it opens whole from Done with nothing acknowledged', async () => {
    const { readRecord: read, calls } = readRecord([aRecorded(1, { payload: HARBOUR })]);

    const page = await read({ caller: CHARLOTTE_GRANT, cursor: null });

    expect({ said: page.isOk ? page.value.items.map(({ contentType, payload }) => ({ contentType, payload })) : page, calls }).toEqual({ said: [{ contentType: 'application/vnd.aeolus.question+json', payload: HARBOUR }], calls: ['record(newest)'] });
  });

  it(`reads ${String(RECORD_PAGE_SIZE)} a page, and the next page after the cursor it answered`, async () => {
    const { readRecord: read, calls } = readRecord(Array.from({ length: RECORD_PAGE_SIZE + 1 }, (_, index) => aRecorded(index + 1)));

    const first = await read({ caller: CHARLOTTE_GRANT, cursor: null });
    const next = await read({ caller: CHARLOTTE_GRANT, cursor: first.isOk ? first.value.nextCursor : null });

    expect({
      first: first.isOk ? { size: first.value.items.length, nextCursor: first.value.nextCursor } : first,
      next: next.isOk ? { ids: next.value.items.map(({ deliveryId }) => deliveryId), nextCursor: next.value.nextCursor } : next,
      calls,
    }).toEqual({
      first: { size: 20, nextCursor: 'dlv_01m3tbfspe96yf1rnr4ank0002' },
      next: { ids: ['dlv_01m3tbfspe96yf1rnr4ank0001'], nextCursor: null },
      calls: ['record(newest)', 'record(dlv_01m3tbfspe96yf1rnr4ank0002)'],
    });
  });

  it('titles a sealed message the fleet cannot unseal as sealed, never by its empty payload', async () => {
    const items = await itemsOf([aRecorded(1, { contentType: 'text/plain', payload: '', headline: null, isPayloadUnreadable: true })]);

    expect(items.map(({ title }) => title)).toEqual(['A sealed message: the fleet cannot unseal it now']);
  });

  it('says the record cannot be read now when the fleet does not answer, so nothing is lost', async () => {
    const reading = readRecord([aRecorded(1)]);
    reading.refusals.record.push({ code: 'FLEET_UNREACHABLE', message: 'The fleet did not answer' });

    await expect(reading.readRecord({ caller: CHARLOTTE_GRANT, cursor: null })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});
