import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { CHARLOTTE_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import { aPersonDelivery, fakePersonShipDoor, memoryOpenedDeliveries } from '../../../test/support/people-fakes.js';
import type { PersonParty } from '../parties/party.js';
import type { PersonDelivery } from './ports.js';
import { createOpenDelivery } from './open-delivery.js';

// A person opens one delivery of their ship's inbox from their MCP client:
// their own act, so the gateway acknowledges it for them (Q20, interop 5.1).

const AT = new Date('2026-10-19T09:00:00.000Z');
const QUESTION = aPersonDelivery();
const NOTE = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', contentType: 'text/plain', payload: 'The build is red', questionTitle: null });

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

let parties: ReturnType<typeof memoryPartyStore>;
let opened: ReturnType<typeof memoryOpenedDeliveries>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(CHARLOTTE);
  opened = memoryOpenedDeliveries();
});

function opening(deliveries: PersonDelivery[]) {
  const ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries });
  return { ...ship, openDelivery: createOpenDelivery({ parties, door: ship.door, opened, clock: { now: () => AT } }) };
}

const CALLER = { fleetId: FLEET_ID, party: 'charlotte' };

describe('a person opens a delivery that waits for their ship', () => {
  it('shows it whole: who sent it, when, its title, content type and payload', async () => {
    const { openDelivery } = opening([NOTE, QUESTION]);

    await expect(openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId })).resolves.toEqual({
      isOk: true,
      value: { deliveryId: QUESTION.deliveryId, from: 'tracker', title: 'Go for release 1.4?', sentAt: '2026-10-19T08:00:00.000Z', contentType: QUESTION.contentType, payload: QUESTION.payload },
    });
  });

  it('acknowledges it for the person, once it kept what an answer needs: its message, its sender and title, never its payload', async () => {
    const { openDelivery, calls } = opening([QUESTION]);

    await openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId });

    expect(calls).toEqual(['inbox', 'pushReceive(10)', `ack(${QUESTION.deliveryId})`]);
    expect([...opened.held.values()]).toEqual([
      { fleetId: FLEET_ID, party: 'charlotte', deliveryId: QUESTION.deliveryId, messageId: QUESTION.messageId, senderShipId: QUESTION.senderShipId, from: 'tracker', title: 'Go for release 1.4?', openedAt: AT },
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

  it('refuses a party that is no person, asking the fleet nothing', async () => {
    const { openDelivery, calls } = opening([QUESTION]);

    await expect(openDelivery({ caller: { fleetId: FLEET_ID, party: 'crm' }, deliveryId: QUESTION.deliveryId })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_PERSON' } });
    expect(calls).toEqual([]);
  });

  it('says the fleet did not answer when it refuses the acknowledgement, keeping what it opened so a second open goes on', async () => {
    const ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [QUESTION] });
    const door = { ...ship.door, ack: () => Promise.resolve({ isOk: false as const, error: { code: 'UNAVAILABLE', message: 'The fleet did not answer' } }) };
    const openDelivery = createOpenDelivery({ parties, door, opened, clock: { now: () => AT } });

    await expect(openDelivery({ caller: CALLER, deliveryId: QUESTION.deliveryId })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
    expect(opened.held.size).toBe(1);
  });
});
