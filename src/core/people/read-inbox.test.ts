import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aPersonDelivery, CHARLOTTE_GRANT, fakeCrewPersonShip, fakePersonShipDoor, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import type { PersonDelivery } from './ports.js';
import { createReadInbox } from './read-inbox.js';

// A person reads their own person ship's inbox from their MCP client, which
// holds no crew token: the gateway crews the ship for them (decisions 0054,
// 0057; Q20).

let crews: ReturnType<typeof memoryPersonCrews>;

beforeEach(() => {
  crews = memoryPersonCrews();
});

function readInbox(deliveries: PersonDelivery[], crewToken = 'aeolus_ct_v1_charlotte') {
  const ship = fakePersonShipDoor({ crewToken, deliveries });
  return { ...ship, readInbox: createReadInbox({ crewPersonShip: fakeCrewPersonShip(crews), crews, door: ship.door }) };
}

describe("a person reads their person ship's inbox: what waits, by titles only", () => {
  it('lists each waiting delivery by who sent it, when, and its title, never its payload', async () => {
    await expect(readInbox([aPersonDelivery()]).readInbox(CHARLOTTE_GRANT)).resolves.toEqual({
      isOk: true,
      value: { waiting: 1, deliveries: [{ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', from: 'tracker', title: 'Go for release 1.4?', sentAt: '2026-10-19T08:00:00.000Z' }] },
    });
  });

  it("titles a message that is no question by its payload's first line", async () => {
    const read = await readInbox([aPersonDelivery({ contentType: 'text/plain', payload: 'The build is red\n\nThree tests fail on main.', questionTitle: null })]).readInbox(CHARLOTTE_GRANT);

    expect(read.isOk ? read.value.deliveries.map(({ title }) => title) : []).toEqual(['The build is red']);
  });

  it('cuts a first line at 80 characters, and keeps one of exactly 80', async () => {
    const eighty = 'a'.repeat(80);

    const read = await readInbox([aPersonDelivery({ contentType: 'text/plain', payload: eighty, questionTitle: null }), aPersonDelivery({ contentType: 'text/plain', payload: `${eighty}b`, questionTitle: null })]).readInbox(CHARLOTTE_GRANT);

    expect(read.isOk ? read.value.deliveries.map(({ title }) => title) : []).toEqual([eighty, `${'a'.repeat(79)}…`]);
  });

  it('lists at most 10, with how many wait in all', async () => {
    const { calls, readInbox: read } = readInbox(Array.from({ length: 12 }, () => aPersonDelivery()));

    const answer = await read(CHARLOTTE_GRANT);

    expect({ waiting: answer.isOk ? answer.value.waiting : 0, listed: answer.isOk ? answer.value.deliveries.length : 0, calls }).toEqual({ waiting: 12, listed: 10, calls: ['inbox', 'pushReceive(10)'] });
  });

  it('takes nothing while nothing waits, so the person is never kept waiting', async () => {
    const { calls, readInbox: read } = readInbox([]);

    await expect(read(CHARLOTTE_GRANT)).resolves.toEqual({ isOk: true, value: { waiting: 0, deliveries: [] } });
    expect(calls).toEqual(['inbox']);
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

  it('says the fleet did not answer when it refuses the person ship even crewed again', async () => {
    await expect(readInbox([], 'aeolus_ct_v1_other').readInbox(CHARLOTTE_GRANT)).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});
