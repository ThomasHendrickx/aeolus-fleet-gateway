import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aPersonDelivery, fakePersonShipDoor } from '../../../test/support/people-fakes.js';
import { CHARLOTTE_SHIP_ID, memoryPartyStore, PROXY_SHIP_ID } from '../../../test/support/party-fakes.js';
import type { PersonParty } from '../parties/party.js';
import { createReadInbox } from './read-inbox.js';

// A person reads their own ship's inbox from their MCP client, which holds no
// crew token: the gateway crews the ship for them (interop 3.3 point 5, Q20).

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

let parties: ReturnType<typeof memoryPartyStore>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(CHARLOTTE);
});

describe("a person reads their ship's inbox: what waits, by titles only", () => {
  it('lists each waiting delivery by who sent it, when, and its title, never its payload', async () => {
    const { door } = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [aPersonDelivery()] });

    const read = await createReadInbox({ parties, door })({ fleetId: FLEET_ID, party: 'charlotte' });

    expect(read).toEqual({ isOk: true, value: { waiting: 1, deliveries: [{ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', from: 'tracker', title: 'Go for release 1.4?', sentAt: '2026-10-19T08:00:00.000Z' }] } });
  });

  it("titles a message that is no question by its payload's first line", async () => {
    const { door } = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [aPersonDelivery({ contentType: 'text/plain', payload: 'The build is red\n\nThree tests fail on main.', questionTitle: null })] });

    const read = await createReadInbox({ parties, door })({ fleetId: FLEET_ID, party: 'charlotte' });

    expect(read.isOk ? read.value.deliveries.map(({ title }) => title) : []).toEqual(['The build is red']);
  });

  it('cuts a first line at 80 characters, and keeps one of exactly 80', async () => {
    const eighty = 'a'.repeat(80);
    const { door } = fakePersonShipDoor({
      crewToken: 'aeolus_ct_v1_charlotte',
      deliveries: [aPersonDelivery({ contentType: 'text/plain', payload: eighty, questionTitle: null }), aPersonDelivery({ contentType: 'text/plain', payload: `${eighty}b`, questionTitle: null })],
    });

    const read = await createReadInbox({ parties, door })({ fleetId: FLEET_ID, party: 'charlotte' });

    expect(read.isOk ? read.value.deliveries.map(({ title }) => title) : []).toEqual([eighty, `${'a'.repeat(79)}…`]);
  });

  it('lists at most 10, with how many wait in all', async () => {
    const deliveries = Array.from({ length: 12 }, () => aPersonDelivery());
    const { door, calls } = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries });

    const read = await createReadInbox({ parties, door })({ fleetId: FLEET_ID, party: 'charlotte' });

    expect({ waiting: read.isOk ? read.value.waiting : 0, listed: read.isOk ? read.value.deliveries.length : 0, calls }).toEqual({ waiting: 12, listed: 10, calls: ['inbox', 'pushReceive(10)'] });
  });

  it('takes nothing while nothing waits, so the person is never kept waiting', async () => {
    const { door, calls } = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [] });

    const read = await createReadInbox({ parties, door })({ fleetId: FLEET_ID, party: 'charlotte' });

    expect({ read, calls }).toEqual({ read: { isOk: true, value: { waiting: 0, deliveries: [] } }, calls: ['inbox'] });
  });

  it.each([
    { what: 'a party that is no person', party: 'crm', save: { ...CHARLOTTE, name: 'crm', kind: 'mcpClient' as const, clientId: 'client-1', proxyShipId: PROXY_SHIP_ID } },
    { what: "another fleet's person", party: 'dirk', save: { ...CHARLOTTE, fleetId: OTHER_FLEET_ID, name: 'dirk' } },
    { what: 'no party', party: 'nobody', save: undefined },
  ])('refuses $what, asking the fleet nothing', async ({ party, save }) => {
    if (save) {
      await parties.save(save);
    }
    const { door, calls } = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [aPersonDelivery()] });

    await expect(createReadInbox({ parties, door })({ fleetId: FLEET_ID, party })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_PERSON' } });
    expect(calls).toEqual([]);
  });

  it("says the fleet did not answer when it refuses the person's ship", async () => {
    const { door } = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_other', deliveries: [] });

    await expect(createReadInbox({ parties, door })({ fleetId: FLEET_ID, party: 'charlotte' })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});
