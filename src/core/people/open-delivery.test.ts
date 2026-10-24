import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { CHARLOTTE_GRANT, aPersonDelivery, fakeCrewPersonShip, fakePersonShipDoor, memoryOpenedDeliveries, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import type { PersonDelivery } from './ports.js';
import { createOpenDelivery } from './open-delivery.js';

// A person opens one delivery of their person ship's inbox from their MCP client:
// their own act, so the gateway acknowledges it for them (Q20, interop 5.1).

const AT = new Date('2026-10-19T09:00:00.000Z');
const QUESTION = aPersonDelivery();
const NOTE = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', contentType: 'text/plain', payload: 'The build is red', questionTitle: null });


let crews: ReturnType<typeof memoryPersonCrews>;
let opened: ReturnType<typeof memoryOpenedDeliveries>;

beforeEach(() => {
  crews = memoryPersonCrews();
  opened = memoryOpenedDeliveries();
});

function opening(deliveries: PersonDelivery[]) {
  const ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries });
  return { ...ship, openDelivery: createOpenDelivery({ crewPersonShip: fakeCrewPersonShip(crews), crews, door: ship.door, opened, clock: { now: () => AT } }) };
}

const CALLER = CHARLOTTE_GRANT;

describe('a person opens a delivery that waits for their person ship', () => {
  it('shows it whole: who sent it, when, its title, content type and payload', async () => {
    const { openDelivery } = opening([NOTE, QUESTION]);

    await expect(openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId })).resolves.toEqual({
      isOk: true,
      value: { deliveryId: QUESTION.deliveryId, from: 'tracker', title: 'Go for release 1.4?', sentAt: '2026-10-19T08:00:00.000Z', contentType: QUESTION.contentType, payload: QUESTION.payload, meetingId: null },
    });
  });

  it('says the meeting a contribution was made to, so the person goes on to it', async () => {
    const contribution = aPersonDelivery({ ...NOTE, payload: 'Marketing is on track', meetingId: 'mtg_01m5qa5j85mgd4z61d9c2k4mtg' });
    const { openDelivery } = opening([contribution]);

    await expect(openDelivery({ caller: CALLER, deliveryId: contribution.deliveryId })).resolves.toMatchObject({ isOk: true, value: { meetingId: 'mtg_01m5qa5j85mgd4z61d9c2k4mtg' } });
  });

  it('acknowledges it for the person, once it kept what an answer and the inbox need: its message, its sender, title and when it was sent, never its payload', async () => {
    const { openDelivery, calls } = opening([QUESTION]);

    await openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId });

    expect(calls).toEqual(['inbox', 'pushReceive(10)', `ack(${QUESTION.deliveryId})`]);
    expect([...opened.held.values()]).toEqual([
      {
        fleetId: FLEET_ID,
        shipId: PERSON_SHIP_ID,
        deliveryId: QUESTION.deliveryId,
        messageId: QUESTION.messageId,
        senderShipId: QUESTION.senderShipId,
        from: 'tracker',
        title: 'Go for release 1.4?',
        sentAt: QUESTION.sentAt,
        openedAt: AT,
      },
    ]);
  });

  it('refuses a delivery that does not wait for the person, acknowledging nothing', async () => {
    const { openDelivery, calls } = opening([NOTE]);

    await expect(openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_DELIVERY' } });
    expect({ calls, opened: opened.held.size }).toEqual({ calls: ['inbox', 'pushReceive(10)'], opened: 0 });
  });

  it('refuses at once while nothing waits', async () => {
    const { openDelivery, calls } = opening([]);

    await expect(openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_DELIVERY' } });
    expect(calls).toEqual(['inbox']);
  });

  it('refuses an account with no person ship, asking the fleet nothing', async () => {
    const { openDelivery, calls } = opening([QUESTION]);

    await expect(openDelivery({ caller: { fleetId: FLEET_ID, grantId: 'grant-2' }, deliveryId: QUESTION.deliveryId })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_PERSON' } });
    expect(calls).toEqual([]);
  });

  it('says the fleet did not answer when it refuses the acknowledgement, keeping what it opened so a second open goes on', async () => {
    const ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [QUESTION] });
    const door = { ...ship.door, ack: () => Promise.resolve({ isOk: false as const, error: { code: 'UNAVAILABLE', message: 'The fleet did not answer' } }) };
    const openDelivery = createOpenDelivery({ crewPersonShip: fakeCrewPersonShip(crews), crews, door, opened, clock: { now: () => AT } });

    await expect(openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
    expect(opened.held.size).toBe(1);
  });
});

describe('a person opens again a delivery they opened, from any client (aeolus-fleet #1046)', () => {
  it('shows it whole again, as the fleet reads it again, acknowledging it once only', async () => {
    const { openDelivery, calls } = opening([QUESTION]);
    const first = await openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId });

    const again = await openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId });

    expect({ again, isSame: JSON.stringify(again) === JSON.stringify(first) }).toEqual({
      again: {
        isOk: true,
        value: { deliveryId: QUESTION.deliveryId, from: 'tracker', title: 'Go for release 1.4?', sentAt: '2026-10-19T08:00:00.000Z', contentType: QUESTION.contentType, payload: QUESTION.payload, meetingId: null },
      },
      isSame: true,
    });
    expect(calls.filter((call) => call.startsWith('ack'))).toEqual([`ack(${QUESTION.deliveryId})`]);
  });

  it('keeps no payload of it: the second open reads it from the fleet', async () => {
    const { openDelivery, calls } = opening([QUESTION]);
    await openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId });

    await openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId });

    expect({ isPayloadKept: JSON.stringify([...opened.held.values()]).includes('All checks are green'), lastCall: calls.at(-1) }).toEqual({ isPayloadKept: false, lastCall: `delivery(${QUESTION.deliveryId})` });
  });

  it('says why when the fleet no longer holds it opened', async () => {
    const { openDelivery, refusals } = opening([QUESTION]);
    await openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId });
    refusals.delivery.push({ code: 'DELIVERY_NOT_ACKNOWLEDGED', message: `Delivery ${QUESTION.deliveryId} is handled, not acknowledged` });

    await expect(openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId })).resolves.toEqual({
      isOk: false,
      error: { kind: 'NO_SUCH_DELIVERY', message: `The fleet no longer holds it opened: Delivery ${QUESTION.deliveryId} is handled, not acknowledged` },
    });
  });
});
