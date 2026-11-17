import { expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aPersonDelivery, fakePersonShipDoor, memoryInboxChanges, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { PERSON_SHIP_ID } from '../../../test/support/sign-in-fakes.js';
import { createPersonInboxWakes } from './person-inbox-wakes.js';

it('a local claim tells the instance holding the stream to read that person inbox', async () => {
  const changes = memoryInboxChanges();
  const crews = memoryPersonCrews();
  await crews.save({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, crewToken: 'person', crewedAt: new Date('2026-11-01') });
  const ship = fakePersonShipDoor({ crewToken: 'person', deliveries: [aPersonDelivery()] });
  const requested: string[] = [];
  const wakes = createPersonInboxWakes({ crews, changes, whoami: (token) => ship.door.whoami(token), request: (token) => { requested.push(token); } });
  await wakes.changed('person');
  expect(changes.told).toEqual([{ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID }]);
  const change = changes.told[0];
  await wakes.told(change ?? { fleetId: OTHER_FLEET_ID, shipId: PERSON_SHIP_ID });
  expect(requested).toEqual(['person', 'person']);
});

it('never requests a different fleet or a forgotten person lease', async () => {
  const crews = memoryPersonCrews();
  await crews.save({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID, crewToken: 'person', crewedAt: new Date('2026-11-01') });
  const requested: string[] = [];
  const ship = fakePersonShipDoor({ crewToken: 'person', deliveries: [] });
  const changes = memoryInboxChanges();
  const wakes = createPersonInboxWakes({ crews, changes, whoami: (token) => ship.door.whoami(token), request: (token) => { requested.push(token); } });
  await wakes.told({ fleetId: OTHER_FLEET_ID, shipId: PERSON_SHIP_ID });
  await crews.drop(FLEET_ID, PERSON_SHIP_ID);
  await wakes.told({ fleetId: FLEET_ID, shipId: PERSON_SHIP_ID });
  await wakes.changed('ended-token');
  expect(requested).toEqual(['ended-token']);
  expect(changes.told).toEqual([]);
});
