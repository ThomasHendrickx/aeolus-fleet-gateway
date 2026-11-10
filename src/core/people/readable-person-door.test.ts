import { QUESTION_CONTENT_TYPE, STEP_CONTENT_TYPE } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { aPersonDelivery, fakePersonShipDoor, memoryLetGoDeliveries, memoryOpenedDeliveries, fakeCrewPersonShip, memoryPersonCrews, CHARLOTTE_GRANT, memoryBasketEntries, memoryItemOutcomes, memoryInboxChanges, memoryRoutes, memoryUnreadableReplies, SENT_MESSAGE_ID } from '../../../test/support/people-fakes.js';
import { createReadBridgeHome } from './read-bridge-home.js';
import { createReadWaitingCount } from './read-waiting-count.js';
import { createStaleSightings } from './stale-sightings.js';
import { routingDefaultsOf } from './routing.js';
import { memoryPartyStore } from '../../../test/support/party-fakes.js';
import { memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { OpenedDelivery } from './ports.js';
import { FIXED_CLOCK } from '../../../test/support/fixed-clock.js';
import { createHeldDeliveries, holdingDoor } from './held-deliveries.js';
import { createReadablePersonState } from './readable-person-state.js';
import { createReadablePersonDoor } from './readable-person-door.js';

const CREW = 'aeolus_ct_v1_charlotte';
const ID = '9b2f6c1e-4a7d-4e0b-8c3f-2d5a6b7c8d9e';
const QUESTION = JSON.stringify({ id: ID, title: 'Release?', context: 'Checks passed', options: [{ key: 1, label: 'Go' }], pick: { option: 1, why: 'Ready' } });
const STEP = JSON.stringify({ id: ID, title: 'Sign in', why: 'Access is needed' });
const UNAVAILABLE = { code: 'UNAVAILABLE', message: 'Try again' };

function setup(contentType: string, payload: string) {
  const delivery = aPersonDelivery({ contentType, payload });
  const ship = fakePersonShipDoor({ crewToken: CREW, deliveries: [delivery] });
  const opened = memoryOpenedDeliveries();
  const { held } = createReadablePersonState({ held: createHeldDeliveries(FIXED_CLOCK), opened });
  const refusals: { deliveryId: string; code: string; message: string }[] = [];
  const door = createReadablePersonDoor(holdingDoor(ship.door, { held, letGo: memoryLetGoDeliveries() }), { opened, replies: memoryUnreadableReplies(), clock: FIXED_CLOCK, refusedReply: (refusal) => { refusals.push(refusal); } });
  return { delivery, ship, door, held, opened, refusals };
}

describe('a person never reads a malformed question or step', () => {
  it.each([QUESTION_CONTENT_TYPE, STEP_CONTENT_TYPE])('returns %s to its sender before acknowledging and handling it', async (contentType) => {
    const { door, ship, delivery } = setup(contentType, '{}');
    expect(await door.pushReceive(CREW, { max: 10 })).toEqual({ isOk: true, value: [] });
    expect(ship.replies).toMatchObject([{ to: delivery.senderShipId, inReplyTo: delivery.messageId, contentType: 'text/plain', idempotencyKey: `unreadable-${delivery.deliveryId}` }]);
    expect(ship.replies).toHaveLength(1);
    expect(ship.replies[0]?.payload).toContain('could not be read');
    expect(ship.replies[0]?.payload).toContain('title');
    expect(ship.calls.filter((call) => call !== 'whoami' && !call.startsWith('pushReceive'))).toEqual([`reply(${delivery.messageId})`, `ack(${delivery.deliveryId})`, `handled(${delivery.deliveryId})`]);
    expect(ship.ship.deliveries).toEqual([]);
  });

  it.each([[QUESTION_CONTENT_TYPE, QUESTION], [STEP_CONTENT_TYPE, STEP]])('leaves a valid %s unchanged', async (contentType, payload) => {
    const { door, ship, delivery } = setup(contentType, payload);
    expect(await door.pushReceive(CREW, { max: 10 })).toEqual({ isOk: true, value: [{ ...delivery, handOverNumber: null }] });
    expect(ship.replies).toEqual([]);
  });

  it('leaves an invalid JSON delivery retryable when the fleet refuses its reply', async () => {
    const { door, ship, delivery } = setup(QUESTION_CONTENT_TYPE, '{');
    ship.refusals.reply.push(UNAVAILABLE);
    const valid = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', payload: QUESTION });
    ship.ship.deliveries.push(valid);
    expect(await door.pushReceive(CREW, { max: 1 })).toEqual({ isOk: true, value: [{ ...valid, handOverNumber: null }] });
    expect(ship.calls).toContain(`ack(${delivery.deliveryId})`);
    await door.inbox(CREW);
    expect(ship.replies[0]?.payload).toContain('Invalid JSON');
    expect(ship.ship.deliveries).not.toContainEqual(delivery);
  });

  it.each(['NOT_FOUND', 'FORBIDDEN'])('handles a malformed delivery when its reply is refused with %s and delivers the next item', async (code) => {
    const { door, ship, delivery, refusals } = setup(QUESTION_CONTENT_TYPE, '{');
    const valid = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', payload: QUESTION });
    ship.ship.deliveries.push(valid);
    ship.refusals.reply.push({ code, message: 'Sender cannot be reached' });
    expect(await door.pushReceive(CREW, { max: 10 })).toEqual({ isOk: true, value: [{ ...valid, handOverNumber: null }] });
    expect(ship.ship.deliveries).not.toContainEqual(delivery);
    expect(ship.calls).toContain(`handled(${delivery.deliveryId})`);
    expect(refusals).toEqual([{ deliveryId: delivery.deliveryId, code, message: 'Sender cannot be reached' }]);
  });

  it('recovers an acknowledged malformed delivery when its sender has retired', async () => {
    const { door, ship, delivery, opened } = setup(STEP_CONTENT_TYPE, '{}');
    ship.refusals.handled.push(UNAVAILABLE);
    await door.pushReceive(CREW, { max: 10 });
    ship.refusals.reply.push({ code: 'NOT_FOUND', message: 'Sender retired' });
    const restarted = createReadablePersonDoor(ship.door, { opened, replies: memoryUnreadableReplies(), clock: FIXED_CLOCK });
    expect(await restarted.inbox(CREW)).toMatchObject({ isOk: true });
    expect(await opened.list(FLEET_ID, PERSON_SHIP_ID)).toEqual([]);
    expect(await ship.door.delivery(CREW, delivery.deliveryId)).toMatchObject({ isOk: false });
  });

  it('uses the same reply key after a restart between reply and handling', async () => {
    const { door, ship, delivery, opened } = setup(STEP_CONTENT_TYPE, '{}');
    ship.refusals.handled.push(UNAVAILABLE);
    expect(await door.pushReceive(CREW, { max: 10 })).toEqual({ isOk: false, error: UNAVAILABLE });
    const restarted = createReadablePersonDoor(ship.door, { opened, replies: memoryUnreadableReplies(), clock: FIXED_CLOCK });
    await restarted.inbox(CREW);
    expect(ship.replies.map(({ idempotencyKey }) => idempotencyKey)).toEqual([`unreadable-${delivery.deliveryId}`, `unreadable-${delivery.deliveryId}`]);
    expect(await ship.door.delivery(CREW, delivery.deliveryId)).toMatchObject({ isOk: false });
  });
});

describe('stored malformed deliveries', () => {
  it.each([QUESTION_CONTENT_TYPE, STEP_CONTENT_TYPE])('hides a stored %s from record, conversation, exchange list and direct reads', async (contentType) => {
    const { delivery } = setup(contentType, '{}');
    const message = { ...delivery, sentAt: delivery.sentAt.toISOString(), isPayloadUnreadable: false, deliveryState: 'handled' as const, receivedDelivery: { deliveryId: delivery.deliveryId, state: 'handled' as const }, otherShipId: delivery.senderShipId };
    const ship = fakePersonShipDoor({ crewToken: CREW, deliveries: [], acknowledged: [delivery], record: [{ ...delivery, state: 'handled', isPayloadUnreadable: false }], exchanges: { messages: [message], summaries: [{ otherShipId: delivery.senderShipId, otherShipName: delivery.senderName, otherShipType: 'worker', otherShipKind: 'agent', unacknowledged: 0, newestMessage: message }] } });
    const door = createReadablePersonDoor(ship.door, { opened: memoryOpenedDeliveries(), replies: memoryUnreadableReplies(), clock: FIXED_CLOCK });
    expect(await door.record(CREW, { cursor: null, limit: 20 })).toEqual({ isOk: true, value: { items: [], nextCursor: null } });
    expect(await door.exchange(CREW, { otherShipId: delivery.senderShipId, start: { kind: 'newest' }, limit: 20 })).toMatchObject({ isOk: true, value: { items: [] } });
    expect(await door.exchanges(CREW, { cursor: null, limit: 20 })).toEqual({ isOk: true, value: { items: [], nextCursor: null } });
    expect(await door.delivery(CREW, delivery.deliveryId)).toMatchObject({ isOk: false, error: { code: 'DELIVERY_NOT_FOUND' } });
  });
});

it('receives a malformed delivery again even when the held cache already has it', () => {
  const { held, delivery } = setup(QUESTION_CONTENT_TYPE, '{}');
  held.hold(CREW, [delivery]);
  expect(held.of(CREW)).toEqual([]);
});

it('hides an already opened malformed question and step while keeping a valid opened question', async () => {
  const opened = memoryOpenedDeliveries();
  const aOpenedDelivery = (changes: Partial<OpenedDelivery>): OpenedDelivery => ({
    fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001',
    messageId: 'msg_01m3tbfspe96yf1rnr4ank0001', senderShipId: PERSON_SHIP_ID,
    from: 'worker', title: '{}', contentType: QUESTION_CONTENT_TYPE, askedQuestionId: null,
    withdrawnQuestionId: null, stepId: null, withdrawnStepId: null, stepLink: null,
    openedIn: null, sentAt: FIXED_CLOCK.now(), openedAt: FIXED_CLOCK.now(), ...changes,
  });
  const question = aOpenedDelivery({ contentType: QUESTION_CONTENT_TYPE, askedQuestionId: null });
  const step = aOpenedDelivery({ contentType: STEP_CONTENT_TYPE, askedQuestionId: null, stepId: null, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002' });
  const valid = aOpenedDelivery({ contentType: QUESTION_CONTENT_TYPE, askedQuestionId: ID, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0003' });
  await opened.save(question);
  await opened.save(step);
  await opened.save(valid);
  const readable = createReadablePersonState({ held: createHeldDeliveries(FIXED_CLOCK), opened });
  expect(await readable.opened.list(question.fleetId, question.shipId)).toEqual([valid]);
  expect(await readable.opened.find(question.fleetId, question)).toBeUndefined();
});

it.each([QUESTION_CONTENT_TYPE, STEP_CONTENT_TYPE])('leaves a malformed %s out of Home and the waiting count, including a held one', async (contentType) => {
  const { door, held, opened: rawOpened, delivery } = setup(contentType, '{}');
  held.hold(CREW, [delivery]);
  const state = createReadablePersonState({ held, opened: rawOpened });
  const crews = memoryPersonCrews();
  const deps = {
    door, ...state, crews, crewPersonShip: fakeCrewPersonShip(crews),
    entries: memoryBasketEntries(), outcomes: memoryItemOutcomes(), changes: memoryInboxChanges(),
    clock: FIXED_CLOCK, sightings: createStaleSightings(), connections: memoryConnectionStore(),
    routes: memoryRoutes(), defaults: routingDefaultsOf([]), parties: memoryPartyStore(),
    ownStepPartyOf: () => undefined, isEmailOffered: false, isWebPushOffered: false,
  };
  expect(await createReadBridgeHome(deps)(CHARLOTTE_GRANT)).toEqual({ isOk: true, value: { waiting: { count: 0, items: [] }, stayAware: [], messages: [] } });
  expect(await createReadWaitingCount(deps)(CHARLOTTE_GRANT)).toEqual({ isOk: true, value: { count: 0 } });
});

it.each([[QUESTION_CONTENT_TYPE, QUESTION], [STEP_CONTENT_TYPE, STEP]])('preserves a stored valid %s and the record cursor', async (contentType, payload) => {
  const delivery = { ...aPersonDelivery({ contentType, payload }), state: 'handled' as const, isPayloadUnreadable: false };
  const ship = fakePersonShipDoor({ crewToken: CREW, deliveries: [], record: [delivery] });
  const door = createReadablePersonDoor(ship.door, { opened: memoryOpenedDeliveries(), replies: memoryUnreadableReplies(), clock: FIXED_CLOCK });
  expect(await door.record(CREW, { cursor: null, limit: 20 })).toEqual({ isOk: true, value: { items: [delivery], nextCursor: null } });
});

it('preserves the unreadable flag for a sealed question whose key is unavailable', async () => {
  const delivery = { ...aPersonDelivery({ payload: '' }), state: 'handled' as const, isPayloadUnreadable: true };
  const ship = fakePersonShipDoor({ crewToken: CREW, deliveries: [], record: [delivery] });
  const door = createReadablePersonDoor(ship.door, { opened: memoryOpenedDeliveries(), replies: memoryUnreadableReplies(), clock: FIXED_CLOCK });
  expect(await door.record(CREW, { cursor: null, limit: 20 })).toEqual({ isOk: true, value: { items: [delivery], nextCursor: null } });
  expect(ship.replies).toEqual([]);
});

it('hides the stored rejection reply from exchanges and summaries while preserving an ordinary reply', async () => {
  const original = aPersonDelivery();
  const reply = { messageId: SENT_MESSAGE_ID, senderShipId: PERSON_SHIP_ID, payload: 'Could not be read', contentType: 'text/plain', inReplyTo: original.messageId, sentAt: original.sentAt.toISOString(), deliveryState: null, receivedDelivery: null, isPayloadUnreadable: false, deliveryId: original.deliveryId, otherShipId: original.senderShipId };
  const ship = fakePersonShipDoor({ crewToken: CREW, deliveries: [], exchanges: { messages: [reply], summaries: [{ otherShipId: original.senderShipId, otherShipName: 'worker', otherShipType: 'worker', otherShipKind: 'agent', unacknowledged: 0, newestMessage: reply }] } });
  const replies = memoryUnreadableReplies();
  const door = createReadablePersonDoor(ship.door, { opened: memoryOpenedDeliveries(), replies, clock: FIXED_CLOCK });
  expect(await door.exchange(CREW, { otherShipId: original.senderShipId, start: { kind: 'newest' }, limit: 20 })).toMatchObject({ isOk: true, value: { items: [{ messageId: SENT_MESSAGE_ID }] } });
  await replies.save(FLEET_ID, { shipId: PERSON_SHIP_ID, messageId: SENT_MESSAGE_ID });
  expect(await door.exchange(CREW, { otherShipId: original.senderShipId, start: { kind: 'newest' }, limit: 20 })).toMatchObject({ isOk: true, value: { items: [] } });
  expect(await door.exchanges(CREW, { cursor: null, limit: 20 })).toMatchObject({ isOk: true, value: { items: [] } });
});

it('hides a recorded rejection reply from record and direct item reads', async () => {
  const reply = aPersonDelivery({ messageId: SENT_MESSAGE_ID, contentType: 'text/plain', payload: 'Could not be read' });
  const ship = fakePersonShipDoor({ crewToken: CREW, deliveries: [], acknowledged: [reply], record: [{ ...reply, state: 'handled', isPayloadUnreadable: false }] });
  const replies = memoryUnreadableReplies();
  await replies.save(FLEET_ID, { shipId: PERSON_SHIP_ID, messageId: SENT_MESSAGE_ID });
  const door = createReadablePersonDoor(ship.door, { opened: memoryOpenedDeliveries(), replies, clock: FIXED_CLOCK });
  expect(await door.record(CREW, { cursor: null, limit: 20 })).toMatchObject({ isOk: true, value: { items: [] } });
  expect(await door.delivery(CREW, reply.deliveryId)).toMatchObject({ isOk: false, error: { code: 'DELIVERY_NOT_FOUND' } });
});

it('receives past a page of malformed deliveries so a valid question still reaches the person', async () => {
  const { ship, door } = setup(QUESTION_CONTENT_TYPE, '{}');
  const valid = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', payload: QUESTION });
  ship.ship.deliveries.push(valid);
  expect(await door.pushReceive(CREW, { max: 1 })).toEqual({ isOk: true, value: [{ ...valid, handOverNumber: null }] });
});

it('returns a malformed question with many schema errors within the fleet payload limit', async () => {
  const { door, ship } = setup(QUESTION_CONTENT_TYPE, JSON.stringify({ options: Array.from({ length: 5_000 }, () => ({})) }));
  await door.pushReceive(CREW, { max: 10 });
  expect(ship.replies).toHaveLength(1);
  expect(Buffer.byteLength(ship.replies[0]?.payload ?? '', 'utf8')).toBeLessThanOrEqual(262_144);
  expect(ship.ship.deliveries).toEqual([]);
});

it('returns an old acknowledged question without option keys once after deployment, despite two unmatched withdrawals', async () => {
  const old = aPersonDelivery({
    payload: JSON.stringify({ id: ID, title: 'Which goes first?', context: 'Choose the next task', options: [{ label: 'Release' }], pick: { option: 1, why: 'Ready' } }),
    headline: null,
    askedQuestionId: null,
    sentAt: new Date('2026-10-18T08:00:00.000Z'),
  });
  const withdrawals = [
    aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', contentType: 'application/vnd.aeolus.question-withdrawal+json', payload: JSON.stringify({ questionId: ID }), askedQuestionId: null, withdrawnQuestionId: ID }),
    aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0003', messageId: 'msg_01m3tbfspe96yf1rnr4ank0003', contentType: 'application/vnd.aeolus.question-withdrawal+json', payload: JSON.stringify({ questionId: ID }), askedQuestionId: null, withdrawnQuestionId: ID }),
  ];
  const ship = fakePersonShipDoor({ crewToken: CREW, deliveries: withdrawals, acknowledged: [old], record: [{ ...old, state: 'acknowledged', isPayloadUnreadable: false }] });
  const opened = memoryOpenedDeliveries();
  await opened.save({
    fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, deliveryId: old.deliveryId,
    messageId: old.messageId, senderShipId: old.senderShipId, from: old.senderName,
    title: old.payload, contentType: QUESTION_CONTENT_TYPE, askedQuestionId: null,
    withdrawnQuestionId: null, stepId: null, withdrawnStepId: null, stepLink: null,
    openedIn: 'bridge', sentAt: old.sentAt, openedAt: old.sentAt,
  });
  // These stores predate this gateway instance: deploying starts recovery with no rejection sent yet.
  const state = createReadablePersonState({ held: createHeldDeliveries(FIXED_CLOCK), opened });
  const door = createReadablePersonDoor(holdingDoor(ship.door, { held: state.held, letGo: memoryLetGoDeliveries() }), { opened, replies: memoryUnreadableReplies(), clock: FIXED_CLOCK });
  const crews = memoryPersonCrews();
  const deps = {
    door, ...state, crews, crewPersonShip: fakeCrewPersonShip(crews),
    entries: memoryBasketEntries(), outcomes: memoryItemOutcomes(), changes: memoryInboxChanges(),
    clock: FIXED_CLOCK, sightings: createStaleSightings(), connections: memoryConnectionStore(),
    routes: memoryRoutes(), defaults: routingDefaultsOf([]), parties: memoryPartyStore(),
    ownStepPartyOf: () => undefined, isEmailOffered: false, isWebPushOffered: false,
  };
  const readHome = createReadBridgeHome(deps);
  expect(await readHome(CHARLOTTE_GRANT)).toEqual({ isOk: true, value: { waiting: { count: 0, items: [] }, stayAware: [], messages: [] } });
  expect(await createReadWaitingCount(deps)(CHARLOTTE_GRANT)).toEqual({ isOk: true, value: { count: 0 } });
  await readHome(CHARLOTTE_GRANT);
  expect(ship.replies).toHaveLength(1);
  expect(ship.replies[0]?.inReplyTo).toBe(old.messageId);
  expect(ship.replies[0]?.payload).toContain('options.0.key');
  expect(await ship.door.delivery(CREW, old.deliveryId)).toMatchObject({ isOk: false });
});
