import { expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { FIXED_CLOCK } from '../../../test/support/fixed-clock.js';
import { aPersonDelivery, fakePersonShipDoor, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { memoryShipWakeups } from '../../../test/support/ship-wakeups.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { ok } from '../shared/result.js';
import { createRefreshingPersonDoor } from './refreshing-person-door.js';
import { createWaitOnPersonShip } from './wait-on-person-ship.js';

it('wakes the person for a message arriving after an exchange was marked seen', async () => {
  const token = 'person-crew';
  const person = { fleetId: FLEET_ID, shipId: PERSON_SHIP_ID };
  const crews = memoryPersonCrews();
  await crews.save({ ...person, crewToken: token, crewedAt: FIXED_CLOCK.now() });
  const message = aPersonDelivery({ contentType: 'text/plain', payload: 'First message', headline: null, askedQuestionId: null, pick: null });
  const ship = { crewToken: token, deliveries: [message] };
  const fleet = fakePersonShipDoor(ship);
  const streams = memoryShipWakeups();
  const door = createRefreshingPersonDoor({
    ...fleet.door,
    // Core's mark-seen acknowledgement removes the plain messages from the waiting count.
    ackUpTo: (_crewToken, seen) => {
      const before = ship.deliveries.length;
      ship.deliveries = ship.deliveries.filter((delivery) => delivery.messageId > seen.messageId);
      return Promise.resolve(ok({ acknowledged: before - ship.deliveries.length }));
    },
  }, (crewToken) => {
    for (const lease of streams.leases) {
      if (lease.token === crewToken) { lease.hints.request(); }
    }
  });
  const woken: string[] = [];
  const stop = new AbortController();
  const wait = createWaitOnPersonShip({
    crews,
    wakeups: streams.open,
    door,
    changes: { tell: () => Promise.resolve() },
    wakePerson: (_ship, crewToken) => { woken.push(crewToken); return Promise.resolve(ok({ kind: 'settled' })); },
    isServed: () => Promise.resolve(true),
    clock: FIXED_CLOCK,
    sleep: () => new Promise(() => undefined),
    againWaitsMs: [100],
    wakeAgainWaitsMs: [100],
  });
  const done = wait(person, stop.signal);
  try {
    await new Promise((resolve) => setImmediate(resolve));
    streams.wake();
    await new Promise((resolve) => setImmediate(resolve));

    await door.ackUpTo(token, { otherShipId: message.senderShipId, messageId: message.messageId });
    await new Promise((resolve) => setImmediate(resolve));
    ship.deliveries.push(aPersonDelivery({ ...message, messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', payload: 'New message' }));
    streams.wake();
    await new Promise((resolve) => setImmediate(resolve));

    expect(woken).toEqual([token, token]);
  } finally {
    stop.abort();
    await done;
  }
});

it('requests no inbox look after a refused mark-seen acknowledgement', async () => {
  const fleet = fakePersonShipDoor({ crewToken: 'person', deliveries: [] });
  fleet.refusals.ackUpTo.push({ code: 'UNAVAILABLE', message: 'The fleet did not answer' });
  const requested: string[] = [];
  const door = createRefreshingPersonDoor(fleet.door, (token) => { requested.push(token); });
  const message = aPersonDelivery();

  await door.ackUpTo('person', { otherShipId: message.senderShipId, messageId: message.messageId });

  expect(requested).toEqual([]);
});

it('requests an inbox look after its own claims and acknowledgements', async () => {
  const token = 'person-crew';
  const delivery = aPersonDelivery();
  const ship = fakePersonShipDoor({ crewToken: token, deliveries: [delivery] });
  const requested: string[] = [];
  const door = createRefreshingPersonDoor(ship.door, (crewToken) => { requested.push(crewToken); });
  await door.pushReceive(token, { max: 1 });
  await door.ack(token, delivery.deliveryId);
  expect(requested).toEqual([token, token]);
});

it('requests no count look for a refused claim, empty claim or refused acknowledgement', async () => {
  const ship = fakePersonShipDoor({ crewToken: 'person', deliveries: [] });
  const requested: string[] = [];
  const door = createRefreshingPersonDoor(ship.door, (token) => { requested.push(token); });
  await door.pushReceive('ended', { max: 1 });
  await door.pushReceive('person', { max: 1 });
  await door.ack('ended', aPersonDelivery().deliveryId);
  expect(requested).toEqual([]);
});
