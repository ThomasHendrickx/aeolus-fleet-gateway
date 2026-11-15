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
