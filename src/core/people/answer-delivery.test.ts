import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { CHARLOTTE_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import { fakePersonShipDoor, memoryOpenedDeliveries } from '../../../test/support/people-fakes.js';
import type { PersonParty } from '../parties/party.js';
import { createAnswerDelivery } from './answer-delivery.js';
import { createDoneDelivery } from './done-delivery.js';
import type { OpenedDelivery } from './ports.js';

// A person deals with a delivery they opened, from their MCP client: they
// answer it, or say they are done with it (Q20). Either way it is handled.

const AT = new Date('2026-10-19T09:00:00.000Z');

const CHARLOTTE: PersonParty = {
  fleetId: FLEET_ID,
  name: 'charlotte',
  kind: 'person',
  email: 'charlotte@example.com',
  issuer: 'https://accounts.google.com',
  subject: '1078',
  ownerShipId: CHARLOTTE_SHIP_ID,
  state: 'crewed',
  proxyShipId: CHARLOTTE_SHIP_ID,
  secret: null,
  crewToken: 'aeolus_ct_v1_charlotte',
  requestId: CHARLOTTE_SHIP_ID,
  requestHash: '',
  approvedAt: AT,
};

/** The tracker's question, as Charlotte opened it. */
const OPENED: OpenedDelivery = {
  fleetId: FLEET_ID,
  party: 'charlotte',
  deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001',
  messageId: 'msg_01m3tbfspe96yf1rnr4ank0001',
  senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9trk',
  from: 'tracker',
  title: 'Go for release 1.4?',
  openedAt: AT,
};

const CALLER = { fleetId: FLEET_ID, party: 'charlotte' };
const ANSWER = { contentType: 'application/vnd.aeolus.answer+json', payload: '{"questionId":"9b2f","option":1}' };

let parties: ReturnType<typeof memoryPartyStore>;
let opened: ReturnType<typeof memoryOpenedDeliveries>;
let ship: ReturnType<typeof fakePersonShipDoor>;
let answerDelivery: ReturnType<typeof createAnswerDelivery>;
let doneDelivery: ReturnType<typeof createDoneDelivery>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(CHARLOTTE);
  opened = memoryOpenedDeliveries();
  await opened.save(OPENED);
  ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [] });
  answerDelivery = createAnswerDelivery({ parties, door: ship.door, opened });
  doneDelivery = createDoneDelivery({ parties, door: ship.door, opened });
});

describe('a person answers a delivery they opened', () => {
  it('replies to its sender, in reply to its message, under a key of the delivery, then it is handled', async () => {
    const answered = await answerDelivery({ caller: CALLER, deliveryId: OPENED.deliveryId, ...ANSWER });

    expect(answered).toEqual({ isOk: true, value: { deliveryId: OPENED.deliveryId, isHandled: true } });
    expect(ship.replies).toEqual([{ to: OPENED.senderShipId, inReplyTo: OPENED.messageId, ...ANSWER, idempotencyKey: `answer-${OPENED.deliveryId}` }]);
    expect(ship.calls).toEqual([`reply(${OPENED.messageId})`, `handled(${OPENED.deliveryId})`]);
  });

  it('forgets what it kept of the delivery once handled, so it is answered once', async () => {
    await answerDelivery({ caller: CALLER, deliveryId: OPENED.deliveryId, ...ANSWER });

    await expect(answerDelivery({ caller: CALLER, deliveryId: OPENED.deliveryId, ...ANSWER })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_DELIVERY' } });
    expect(opened.held.size).toBe(0);
  });

  it('sends the same answer under the same key when the person tries again after the fleet did not take handled, so it is sent once', async () => {
    ship.refusals.handled.push({ code: 'UNAVAILABLE', message: 'The fleet did not answer' });

    await expect(answerDelivery({ caller: CALLER, deliveryId: OPENED.deliveryId, ...ANSWER })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
    await expect(answerDelivery({ caller: CALLER, deliveryId: OPENED.deliveryId, ...ANSWER })).resolves.toMatchObject({ isOk: true });
    expect(new Set(ship.replies.map(({ idempotencyKey }) => idempotencyKey))).toEqual(new Set([`answer-${OPENED.deliveryId}`]));
  });

  it("says why the fleet refused the answer, keeping the delivery to answer again, not handled", async () => {
    ship.refusals.reply.push({ code: 'PAYLOAD_TOO_LARGE', message: 'A payload is at most 64 KB' });

    await expect(answerDelivery({ caller: CALLER, deliveryId: OPENED.deliveryId, ...ANSWER })).resolves.toEqual({
      isOk: false,
      error: { kind: 'SEND_REFUSED', message: 'The fleet did not take your answer: A payload is at most 64 KB' },
    });
    expect({ calls: ship.calls, kept: opened.held.size }).toEqual({ calls: [`reply(${OPENED.messageId})`], kept: 1 });
  });

  it.each([
    { what: 'a delivery the person did not open', caller: CALLER, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0009' },
    { what: "another party's opened delivery", caller: { fleetId: FLEET_ID, party: 'dirk' }, deliveryId: OPENED.deliveryId },
  ])('refuses $what, sending nothing', async ({ caller, deliveryId }) => {
    if (caller.party === 'dirk') {
      await parties.save({ ...CHARLOTTE, name: 'dirk', email: 'dirk@example.com' });
    }

    await expect(answerDelivery({ caller, deliveryId, ...ANSWER })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_DELIVERY' } });
    expect(ship.calls).toEqual([]);
  });

  it('refuses a party that is no person, sending nothing', async () => {
    await expect(answerDelivery({ caller: { fleetId: FLEET_ID, party: 'crm' }, deliveryId: OPENED.deliveryId, ...ANSWER })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_PERSON' } });
    expect(ship.calls).toEqual([]);
  });
});

describe('a person is done with a delivery they opened, with no answer', () => {
  it('is handled, and forgotten, sending nothing', async () => {
    const done = await doneDelivery({ caller: CALLER, deliveryId: OPENED.deliveryId });

    expect(done).toEqual({ isOk: true, value: { deliveryId: OPENED.deliveryId, isHandled: true } });
    expect({ calls: ship.calls, kept: opened.held.size }).toEqual({ calls: [`handled(${OPENED.deliveryId})`], kept: 0 });
  });

  it('refuses a delivery the person did not open', async () => {
    await expect(doneDelivery({ caller: CALLER, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0009' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_DELIVERY' } });
    expect(ship.calls).toEqual([]);
  });

  it('keeps it when the fleet did not take handled, so done goes on again', async () => {
    ship.refusals.handled.push({ code: 'UNAVAILABLE', message: 'The fleet did not answer' });

    await expect(doneDelivery({ caller: CALLER, deliveryId: OPENED.deliveryId })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
    await expect(doneDelivery({ caller: CALLER, deliveryId: OPENED.deliveryId })).resolves.toMatchObject({ isOk: true });
  });

  it('refuses a party that is no person', async () => {
    await expect(doneDelivery({ caller: { fleetId: FLEET_ID, party: 'crm' }, deliveryId: OPENED.deliveryId })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_PERSON' } });
  });
});
