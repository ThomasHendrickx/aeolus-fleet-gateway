import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, fakeGatewayFleet, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { memoryFleetSwitches, memoryInstallationRequests, plainHasher } from '../../../test/support/memory-installation.js';
import { createSetFleetEnabled } from './set-fleet-enabled.js';

const AT = new Date('2026-10-18T12:00:00.000Z');

let fleet: ReturnType<typeof fakeGatewayFleet>;
let switches: ReturnType<typeof memoryFleetSwitches>;
let requests: ReturnType<typeof memoryInstallationRequests>;
let connections: ReturnType<typeof memoryConnectionStore>;
let setEnabled: ReturnType<typeof createSetFleetEnabled>;

beforeEach(() => {
  fleet = fakeGatewayFleet();
  switches = memoryFleetSwitches();
  requests = memoryInstallationRequests();
  connections = memoryConnectionStore();
  setEnabled = createSetFleetEnabled({ switches, requests, hasher: plainHasher, clock: { now: () => AT }, connections, door: fleet.door });
});

async function connected(): Promise<void> {
  const registered = await fleet.door.register({ shipId: SHIP_ID, secret: fleet.state.secret });
  if (registered.isOk) {
    await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: registered.value.crewToken, crewedAt: AT });
  }
}

describe('switching the gateway on or off for a fleet (decision 0021)', () => {
  it('turns it on, and off again', async () => {
    await expect(setEnabled({ requestId: 'r-1', fleetId: FLEET_ID, isEnabled: true })).resolves.toEqual({ isOk: true, value: { fleetId: FLEET_ID, isEnabled: true } });
    expect(switches.held.get(FLEET_ID)).toBe(true);

    await expect(setEnabled({ requestId: 'r-2', fleetId: FLEET_ID, isEnabled: false })).resolves.toEqual({ isOk: true, value: { fleetId: FLEET_ID, isEnabled: false } });
    expect(switches.held.get(FLEET_ID)).toBe(false);
  });

  it('answers a replayed request id with its first answer, and changes nothing again', async () => {
    await setEnabled({ requestId: 'r-1', fleetId: FLEET_ID, isEnabled: true });
    await setEnabled({ requestId: 'r-2', fleetId: FLEET_ID, isEnabled: false });

    await expect(setEnabled({ requestId: 'r-1', fleetId: FLEET_ID, isEnabled: true })).resolves.toEqual({ isOk: true, value: { fleetId: FLEET_ID, isEnabled: true } });
    expect(switches.held.get(FLEET_ID)).toBe(false);
  });

  it('refuses a request id used for another request', async () => {
    await setEnabled({ requestId: 'r-1', fleetId: FLEET_ID, isEnabled: true });

    await expect(setEnabled({ requestId: 'r-1', fleetId: FLEET_ID, isEnabled: false })).resolves.toMatchObject({ isOk: false, error: { kind: 'REQUEST_ID_USED' } });
    expect(switches.held.get(FLEET_ID)).toBe(true);
  });
});

describe('the gateway switches on whatever network the fleet has (interop I-3, Thomas 20 Oct)', () => {
  it('switches on a connected fleet, asking the fleet nothing, even while it does not answer', async () => {
    await connected();
    fleet.state.isAnswering = false;

    await expect(setEnabled({ requestId: 'r-1', fleetId: FLEET_ID, isEnabled: true })).resolves.toEqual({ isOk: true, value: { fleetId: FLEET_ID, isEnabled: true } });
  });
});
