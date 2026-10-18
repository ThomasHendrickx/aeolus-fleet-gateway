import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, fakeGatewayFleet, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { createReadConnection } from './read-connection.js';

const AT = new Date('2026-10-18T11:00:00.000Z');

let fleet: ReturnType<typeof fakeGatewayFleet>;
let store: ReturnType<typeof memoryConnectionStore>;
let readConnection: ReturnType<typeof createReadConnection>;

beforeEach(async () => {
  fleet = fakeGatewayFleet();
  store = memoryConnectionStore();
  readConnection = createReadConnection({ door: fleet.door, store });
  const registered = await fleet.door.register({ shipId: SHIP_ID, secret: fleet.state.secret });
  if (registered.isOk) {
    await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: registered.value.crewToken, crewedAt: AT });
  }
});

describe('whether the gateway is connected to a fleet', () => {
  it('reads connected while the fleet takes its crew token', async () => {
    await expect(readConnection(FLEET_ID)).resolves.toEqual({ state: 'connected', ship: { shipId: SHIP_ID, name: 'gateway' }, lastShipId: SHIP_ID });
  });

  it('drops a crew token the fleet no longer takes, and reads not connected with the last ship', async () => {
    fleet.state.liveTokens.clear();

    await expect(readConnection(FLEET_ID)).resolves.toEqual({ state: 'not-connected', ship: null, lastShipId: SHIP_ID });
    expect(store.held.size).toBe(0);
  });

  it('keeps the crew token while the fleet does not answer, reading connected by the name it kept', async () => {
    fleet.state.isAnswering = false;

    await expect(readConnection(FLEET_ID)).resolves.toEqual({ state: 'connected', ship: { shipId: SHIP_ID, name: 'gateway' }, lastShipId: SHIP_ID });
    expect(store.held.size).toBe(1);
  });

  it('reads not connected, with no last ship, for a fleet never connected', async () => {
    await store.drop(FLEET_ID);
    const fresh = createReadConnection({ door: fleet.door, store: memoryConnectionStore() });

    await expect(fresh(FLEET_ID)).resolves.toEqual({ state: 'not-connected', ship: null, lastShipId: null });
  });
});
