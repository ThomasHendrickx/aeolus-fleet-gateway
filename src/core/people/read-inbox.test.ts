import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { aPersonDelivery, CHARLOTTE_GRANT, fakeCrewPersonShip, fakePersonShipDoor, memoryOpenedDeliveries, memoryPersonCrews, memoryRoutes, memoryLetGoDeliveries } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { createHeldDeliveries, holdingDoor, type HeldDeliveries } from './held-deliveries.js';
import type { OpenedDelivery, PersonDelivery } from './ports.js';
import { createReadInbox } from './read-inbox.js';
import { ITEM_JOBS, routingDefaultsOf, type Route } from './routing.js';
import { FIXED_CLOCK } from '../../../test/support/fixed-clock.js';

// A person reads their own person ship's inbox from their MCP client, which
// holds no crew token: the gateway crews the ship for them (decisions 0054,
// 0057; Q20).

let crews: ReturnType<typeof memoryPersonCrews>;
let opened: ReturnType<typeof memoryOpenedDeliveries>;

/** The gateway's own ship, which sends a person its own steps (CC14). */
const GATEWAY_SHIP_ID = 'shp_01m3tbfspe96yf1rnr4ank0gat';
let connections: ReturnType<typeof memoryConnectionStore>;

beforeEach(async () => {
  crews = memoryPersonCrews();
  opened = memoryOpenedDeliveries();
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: GATEWAY_SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: new Date('2026-10-01T00:00:00.000Z') });
});

/** A chat on for every job, as the gateway's defaults have it (Bridge, CC19). */
const CHAT_ON = routingDefaultsOf(ITEM_JOBS.map((job) => ({ job, place: 'chat' as const })));

function readInbox(deliveries: PersonDelivery[], options: { crewToken?: string; routes?: Route[]; isExcludingIgnored?: boolean; held?: HeldDeliveries } = {}) {
  const { crewToken = 'aeolus_ct_v1_charlotte', routes = [], isExcludingIgnored = false, held = createHeldDeliveries(FIXED_CLOCK) } = options;
  const ship = fakePersonShipDoor({ crewToken, deliveries, isExcludingIgnored });
  const door = holdingDoor(ship.door, { held, letGo: memoryLetGoDeliveries() });
  return { ...ship, door, readInbox: createReadInbox({ crewPersonShip: fakeCrewPersonShip(crews), crews, door, held, opened, routes: memoryRoutes(routes), defaults: CHAT_ON, connections }) };
}

function aChatRoute(overrides: Partial<Route>): Route {
  return { fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, job: 'decide', place: 'chat', isOn: false, changedAt: new Date('2026-10-19T09:00:00.000Z'), ...overrides };
}

/** The issue tracker's note, as Charlotte opened it from one of her clients. */
const OPENED: OpenedDelivery = {
  fleetId: FLEET_ID,
  shipId: PERSON_SHIP_ID,
  deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0009',
  messageId: 'msg_01m3tbfspe96yf1rnr4ank0009',
  senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9trk',
  from: 'tracker',
  title: 'The build is red',
  contentType: 'text/plain',
  askedQuestionId: null,
  withdrawnQuestionId: null,
  stepId: null,
  withdrawnStepId: null,
  stepLink: null,
  openedIn: null,
  sentAt: new Date('2026-10-19T07:00:00.000Z'),
  openedAt: new Date('2026-10-19T07:30:00.000Z'),
};
/** As many waiting deliveries, each its own, the oldest first. */
function manyDeliveries(count: number): PersonDelivery[] {
  return Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(4, '0');
    return aPersonDelivery({ deliveryId: `dlv_01m3tbfspe96yf1rnr4ank${number}`, messageId: `msg_01m3tbfspe96yf1rnr4ank${number}` });
  });
}

const OPENED_ENTRY = { deliveryId: OPENED.deliveryId, from: 'tracker', fromShipId: 'shp_01m3tbfspe96yf1rnr4ank9trk', title: 'The build is red', sentAt: '2026-10-19T07:00:00.000Z', job: 'everything-else', pick: null };

describe("a person reads their person ship's inbox: what waits, by titles only", () => {
  it('lists each waiting delivery by who sent it, when, and its title, never its payload', async () => {
    await expect(readInbox([aPersonDelivery()]).readInbox(CHARLOTTE_GRANT)).resolves.toEqual({
      isOk: true,
      value: { waiting: 1, deliveries: [{ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', from: 'tracker', fromShipId: 'shp_01m3tbfspe96yf1rnr4ank9trk', title: 'Go for release 1.4?', sentAt: '2026-10-19T08:00:00.000Z', job: 'decide', pick: null }], opened: [] },
    });
  });

  it("titles a message that is no question by its payload's first line", async () => {
    const read = await readInbox([aPersonDelivery({ contentType: 'text/plain', payload: 'The build is red\n\nThree tests fail on main.', headline: null })]).readInbox(CHARLOTTE_GRANT);

    expect(read.isOk ? read.value.deliveries.map(({ title }) => title) : []).toEqual(['The build is red']);
  });

  it('cuts a first line at 80 characters, and keeps one of exactly 80', async () => {
    const eighty = 'a'.repeat(80);

    const read = await readInbox([aPersonDelivery({ contentType: 'text/plain', payload: eighty, headline: null }), aPersonDelivery({ contentType: 'text/plain', payload: `${eighty}b`, headline: null })]).readInbox(CHARLOTTE_GRANT);

    expect(read.isOk ? read.value.deliveries.map(({ title }) => title) : []).toEqual([eighty, `${'a'.repeat(79)}…`]);
  });

  it('lists every delivery that waits, however many, taking 10 at a time past the ones it took', async () => {
    const { calls, readInbox: read } = readInbox(manyDeliveries(25));

    const answer = await read(CHARLOTTE_GRANT);

    expect({ waiting: answer.isOk ? answer.value.waiting : 0, listed: answer.isOk ? answer.value.deliveries.length : 0, calls }).toEqual({
      waiting: 25,
      listed: 25,
      calls: ['inbox', 'pushReceive(10)', 'pushReceive(10, excluding 10)', 'pushReceive(10, excluding 20)'],
    });
  });

  it('takes once when exactly 10 wait, and again for the 11th', async () => {
    const ten = readInbox(manyDeliveries(10));
    const eleven = readInbox(manyDeliveries(11));

    const [tenRead, elevenRead] = [await ten.readInbox(CHARLOTTE_GRANT), await eleven.readInbox(CHARLOTTE_GRANT)];

    expect({ ten: tenRead.isOk && tenRead.value.deliveries.length, tenCalls: ten.calls, eleven: elevenRead.isOk && elevenRead.value.deliveries.length, elevenCalls: eleven.calls }).toEqual({
      ten: 10,
      tenCalls: ['inbox', 'pushReceive(10)'],
      eleven: 11,
      elevenCalls: ['inbox', 'pushReceive(10)', 'pushReceive(10, excluding 10)'],
    });
  });

  it('stops taking once the fleet takes nothing new, as a core that keeps no exclusions does, with how many wait in all', async () => {
    const { calls, readInbox: read } = readInbox(manyDeliveries(12), { isExcludingIgnored: true });

    const answer = await read(CHARLOTTE_GRANT);

    expect({ waiting: answer.isOk ? answer.value.waiting : 0, listed: answer.isOk ? answer.value.deliveries.length : 0, calls }).toEqual({ waiting: 12, listed: 10, calls: ['inbox', 'pushReceive(10)', 'pushReceive(10, excluding 10)'] });
  });

  it('takes nothing while nothing waits, so the person is never kept waiting', async () => {
    const { calls, readInbox: read } = readInbox([]);

    await expect(read(CHARLOTTE_GRANT)).resolves.toEqual({ isOk: true, value: { waiting: 0, deliveries: [], opened: [] } });
    expect(calls).toEqual(['inbox']);
  });

  it('lists apart the deliveries the person opened and has not answered or done yet, from any client, by titles only', async () => {
    await opened.save(OPENED);

    await expect(readInbox([aPersonDelivery()]).readInbox(CHARLOTTE_GRANT)).resolves.toEqual({
      isOk: true,
      value: { waiting: 1, deliveries: [{ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', from: 'tracker', fromShipId: 'shp_01m3tbfspe96yf1rnr4ank9trk', title: 'Go for release 1.4?', sentAt: '2026-10-19T08:00:00.000Z', job: 'decide', pick: null }], opened: [OPENED_ENTRY] },
    });
  });

  it('lists what the person opened while nothing waits', async () => {
    await opened.save(OPENED);

    await expect(readInbox([]).readInbox(CHARLOTTE_GRANT)).resolves.toEqual({ isOk: true, value: { waiting: 0, deliveries: [], opened: [OPENED_ENTRY] } });
  });

  it('lists a delivery as waiting only while the fleet did not take its acknowledgement', async () => {
    const question = aPersonDelivery();
    await opened.save({ ...OPENED, deliveryId: question.deliveryId, messageId: question.messageId, title: 'Go for release 1.4?' });

    const read = await readInbox([question]).readInbox(CHARLOTTE_GRANT);

    expect(read.isOk && { deliveries: read.value.deliveries.map(({ deliveryId }) => deliveryId), opened: read.value.opened }).toEqual({ deliveries: [question.deliveryId], opened: [] });
  });

  it('crews the person ship again once when its crew no longer works, as when its lease ended', async () => {
    await crews.save({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, crewToken: 'aeolus_ct_v1_ended', crewedAt: new Date('2026-10-19T08:00:00.000Z') });
    const { calls, readInbox: read } = readInbox([aPersonDelivery()]);

    await expect(read(CHARLOTTE_GRANT)).resolves.toMatchObject({ isOk: true, value: { waiting: 1 } });
    expect({ calls, crews: crews.held.map(({ crewToken }) => crewToken) }).toEqual({ calls: ['inbox', 'inbox', 'pushReceive(10)'], crews: ['aeolus_ct_v1_charlotte'] });
  });

  it('refuses an account with no person ship: it may not message here (decision 0052), asking the fleet nothing', async () => {
    const { calls, readInbox: read } = readInbox([aPersonDelivery()]);

    await expect(read({ fleetId: FLEET_ID, grantId: 'grant-2' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_PERSON' } });
    expect(calls).toEqual([]);
  });

  it('says the message is sealed and the key not reachable when the fleet cannot unseal what waits, keeping the crew', async () => {
    const { readInbox: read, refusals } = readInbox([aPersonDelivery()]);
    refusals.pushReceive.push({ code: 'KEY_UNAVAILABLE', message: "The fleet's company key is not reachable: access denied" });

    await expect(read(CHARLOTTE_GRANT)).resolves.toMatchObject({ isOk: false, error: { kind: 'KEY_UNAVAILABLE' } });
    expect(crews.held).toHaveLength(1);
  });

  it('says the fleet did not answer when it refuses the person ship even crewed again', async () => {
    await expect(readInbox([], { crewToken: 'aeolus_ct_v1_other' }).readInbox(CHARLOTTE_GRANT)).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});

describe('a look at what waits is a read once the gateway holds it (aeolus-fleet #1647)', () => {
  /** The ids a look listed as waiting, in order. */
  const listedOf = (read: Awaited<ReturnType<ReturnType<typeof readInbox>['readInbox']>>) => (read.isOk ? read.value.deliveries.map(({ deliveryId }) => deliveryId) : []);

  it('looks again at as many waiting by asking only how many wait, listing what it holds', async () => {
    const waiting = manyDeliveries(15);
    const look = readInbox(waiting);
    await look.readInbox(CHARLOTTE_GRANT);
    look.calls.length = 0;

    const again = await look.readInbox(CHARLOTTE_GRANT);

    expect({ listed: listedOf(again), calls: look.calls }).toEqual({ listed: waiting.map(({ deliveryId }) => deliveryId), calls: ['inbox'] });
  });

  it('receives only past what it holds once more wait', async () => {
    const waiting = manyDeliveries(16);
    const look = readInbox(waiting.slice(0, 15));
    await look.readInbox(CHARLOTTE_GRANT);
    look.calls.length = 0;
    look.ship.deliveries.push(waiting[15] ?? aPersonDelivery());

    const again = await look.readInbox(CHARLOTTE_GRANT);

    expect({ listed: listedOf(again), calls: look.calls }).toEqual({ listed: waiting.map(({ deliveryId }) => deliveryId), calls: ['inbox', 'pushReceive(10, excluding 15)'] });
  });

  it('receives every one again once fewer wait than it holds', async () => {
    const waiting = manyDeliveries(15);
    const look = readInbox([...waiting]);
    await look.readInbox(CHARLOTTE_GRANT);
    look.calls.length = 0;
    look.ship.deliveries.splice(0, 1);

    const again = await look.readInbox(CHARLOTTE_GRANT);

    expect({ listed: listedOf(again), calls: look.calls }).toEqual({ listed: waiting.slice(1).map(({ deliveryId }) => deliveryId), calls: ['inbox', 'pushReceive(10)', 'pushReceive(10, excluding 10)'] });
  });

  it('lists the one that arrived and not the one the gateway acknowledged, as many waiting as before', async () => {
    const waiting = manyDeliveries(16);
    const look = readInbox(waiting.slice(0, 15));
    await look.readInbox(CHARLOTTE_GRANT);
    await look.door.ack('aeolus_ct_v1_charlotte', waiting[0]?.deliveryId ?? 'dlv_01m3tbfspe96yf1rnr4ank0001');
    look.ship.deliveries.push(waiting[15] ?? aPersonDelivery());

    const again = await look.readInbox(CHARLOTTE_GRANT);

    expect(listedOf(again)).toEqual(waiting.slice(1).map(({ deliveryId }) => deliveryId));
  });

  it('receives what waits again under a new crew, as once the lease ended', async () => {
    const held = createHeldDeliveries(FIXED_CLOCK);
    held.hold('aeolus_ct_v1_ended', manyDeliveries(1));
    await crews.save({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, crewToken: 'aeolus_ct_v1_ended', crewedAt: new Date('2026-10-19T08:00:00.000Z') });
    const look = readInbox([aPersonDelivery()], { held });

    await look.readInbox(CHARLOTTE_GRANT);

    expect(look.calls).toEqual(['inbox', 'inbox', 'pushReceive(10)']);
  });
});

describe('a chat lists only the jobs on for it (Bridge, section 8)', () => {
  const PLAIN = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', contentType: 'text/plain', payload: 'Release 1.4 is out', headline: null, askedQuestionId: null });

  it('leaves out what waits of a job a chat is off for, counting only what it lists', async () => {
    const read = await readInbox([aPersonDelivery(), PLAIN], { routes: [aChatRoute({ job: 'decide' })] }).readInbox(CHARLOTTE_GRANT);

    expect(read.isOk && { waiting: read.value.waiting, listed: read.value.deliveries.map(({ deliveryId }) => deliveryId) }).toEqual({ waiting: 1, listed: [PLAIN.deliveryId] });
  });

  it('leaves out what was opened of a job a chat is off for', async () => {
    await opened.save(OPENED);

    const read = await readInbox([], { routes: [aChatRoute({ job: 'everything-else' })] }).readInbox(CHARLOTTE_GRANT);

    expect(read.isOk && read.value.opened).toEqual([]);
  });

  it('lists every item of a job not done once a chat is turned on for it, whenever it arrived (CC20)', async () => {
    const read = await readInbox([aPersonDelivery()], { routes: [aChatRoute({ job: 'decide', isOn: true })] }).readInbox(CHARLOTTE_GRANT);

    expect(read.isOk && read.value.deliveries.map(({ deliveryId }) => deliveryId)).toEqual([aPersonDelivery().deliveryId]);
  });
});

describe("a chat leaves the gateway's own steps out: they show in Bridge only (BH8)", () => {
  const OWN_STEP = aPersonDelivery({
    deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0gs1',
    messageId: 'msg_01m3tbfspe96yf1rnr4ank0gs1',
    senderShipId: GATEWAY_SHIP_ID,
    senderName: 'gateway',
    contentType: 'application/vnd.aeolus.step+json',
    headline: 'Sign in to the outside party linear',
    askedQuestionId: null,
    stepId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  });

  it("lists neither the gateway's own step that waits nor counts it", async () => {
    const inbox = await readInbox([OWN_STEP, aPersonDelivery()]).readInbox(CHARLOTTE_GRANT);

    expect(inbox.isOk ? { waiting: inbox.value.waiting, listed: inbox.value.deliveries.map(({ deliveryId }) => deliveryId) } : inbox).toEqual({ waiting: 1, listed: ['dlv_01m3tbfspe96yf1rnr4ank0001'] });
  });

  it("lists no gateway's own step the person opened", async () => {
    await opened.save({ ...OPENED, deliveryId: OWN_STEP.deliveryId, senderShipId: GATEWAY_SHIP_ID, contentType: OWN_STEP.contentType, askedQuestionId: null, stepId: OWN_STEP.stepId });

    const inbox = await readInbox([]).readInbox(CHARLOTTE_GRANT);

    expect(inbox.isOk ? inbox.value.opened : inbox).toEqual([]);
  });
});

const ASKED_QUESTION = {
  id: '3f0c7a52-6d1e-4b8a-9c2f-5a1d8e7b4c90',
  title: 'Go for release 1.4?',
  context: 'All checks are green.',
  options: [{ key: 1, label: 'Go' }, { key: 2, label: 'Hold' }],
  pick: { option: 2, why: 'One check is still running.' },
};
const ASKED_WITH_PICK = JSON.stringify(ASKED_QUESTION);

describe('a chat lists each item with its job and, for a question, the asker pick, so it can say what waits without opening any', () => {
  it("gives a question its job decide and the asker's pick with why", async () => {
    const read = await readInbox([aPersonDelivery({ payload: ASKED_WITH_PICK })]).readInbox(CHARLOTTE_GRANT);

    expect(read.isOk && read.value.deliveries.map(({ job, pick }) => ({ job, pick }))).toEqual([{ job: 'decide', pick: { option: 2, why: 'One check is still running.' } }]);
  });

  it('gives no pick to a question whose payload is no question', async () => {
    const read = await readInbox([aPersonDelivery({ payload: 'not json' })]).readInbox(CHARLOTTE_GRANT);

    expect(read.isOk && read.value.deliveries.map(({ job, pick }) => ({ job, pick }))).toEqual([{ job: 'decide', pick: null }]);
  });

  it.each([
    ['application/vnd.aeolus.step+json', 'do'],
    ['application/vnd.aeolus.alert+json', 'stay-aware'],
    ['application/vnd.aeolus.notice+json', 'stay-aware'],
    ['text/plain', 'everything-else'],
  ])('gives a delivery of %s the job %s and no pick', async (contentType, job) => {
    const read = await readInbox([aPersonDelivery({ contentType, payload: ASKED_WITH_PICK, headline: null })]).readInbox(CHARLOTTE_GRANT);

    expect(read.isOk && read.value.deliveries.map((entry) => ({ job: entry.job, pick: entry.pick }))).toEqual([{ job, pick: null }]);
  });
});

describe('a replacement', () => {
  it("gives the asker's pick of the new question it asks", async () => {
    const payload = JSON.stringify({ questionId: '7d2e9b14-0c3a-4f5e-8a61-2b9c4d0e1f37', question: ASKED_QUESTION });
    const read = await readInbox([aPersonDelivery({ contentType: 'application/vnd.aeolus.question-replacement+json', payload })]).readInbox(CHARLOTTE_GRANT);

    expect(read.isOk && read.value.deliveries.map(({ job, pick }) => ({ job, pick }))).toEqual([{ job: 'decide', pick: { option: 2, why: 'One check is still running.' } }]);
  });
});

describe('a chat lists no meeting notice: it is informational or out of date, and the record keeps it (decision 0061)', () => {
  const noticeOf = (suffix: string, contentType: string) =>
    aPersonDelivery({ deliveryId: `dlv_01m3tbfspe96yf1rnr4ank${suffix}`, messageId: `msg_01m3tbfspe96yf1rnr4ank${suffix}`, contentType, payload: '{"meetingId":"mtg_01m5qa5j85mgd4z61d9c2k4mtg"}', headline: null, askedQuestionId: null });
  const NOTICES = [noticeOf('0021', 'application/vnd.aeolus.meeting.added+json'), noticeOf('0022', 'application/vnd.aeolus.meeting.mic+json'), noticeOf('0023', 'application/vnd.aeolus.meeting.ended+json')];

  it('leaves out the added, mic and ended notices that wait, counting only what it lists', async () => {
    const read = await readInbox([...NOTICES, aPersonDelivery()]).readInbox(CHARLOTTE_GRANT);

    expect(read.isOk && { waiting: read.value.waiting, listed: read.value.deliveries.map(({ deliveryId }) => deliveryId) }).toEqual({ waiting: 1, listed: ['dlv_01m3tbfspe96yf1rnr4ank0001'] });
  });

  it('leaves out a meeting notice the person opened', async () => {
    await opened.save({ ...OPENED, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0021', contentType: 'application/vnd.aeolus.meeting.added+json' });

    const read = await readInbox([]).readInbox(CHARLOTTE_GRANT);

    expect(read.isOk && read.value.opened).toEqual([]);
  });

  it("lists a meeting's own contribution, which is a message", async () => {
    const contribution = aPersonDelivery({ ...noticeOf('0024', 'text/plain'), payload: 'Marketing is on track', meetingId: 'mtg_01m5qa5j85mgd4z61d9c2k4mtg' });

    const read = await readInbox([contribution]).readInbox(CHARLOTTE_GRANT);

    expect(read.isOk && read.value.deliveries.map(({ deliveryId }) => deliveryId)).toEqual([contribution.deliveryId]);
  });
});
