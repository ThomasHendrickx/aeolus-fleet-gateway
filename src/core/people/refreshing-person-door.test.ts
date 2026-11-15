import { expect, it } from 'vitest';

import { aPersonDelivery, fakePersonShipDoor } from '../../../test/support/people-fakes.js';
import { createRefreshingPersonDoor } from './refreshing-person-door.js';

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
