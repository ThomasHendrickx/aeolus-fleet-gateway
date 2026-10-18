import { describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { memoryFleetSwitches } from '../../../test/support/memory-installation.js';
import { createIsServed } from './served.js';
import { createReadFleet } from './read-fleet.js';

const AT = new Date('2026-10-18T12:00:00.000Z');

describe('a fleet as the hosting service reads it', () => {
  it('reads off and not connected for a fleet never switched', async () => {
    const readFleet = createReadFleet({ isServed: createIsServed({ installation: 'enabled', switches: memoryFleetSwitches() }), connections: memoryConnectionStore() });

    await expect(readFleet({ fleetId: FLEET_ID })).resolves.toEqual({ isEnabled: false, isConnected: false });
  });

  it('reads off and connected for a connected fleet switched off: its connection waits', async () => {
    const connections = memoryConnectionStore();
    await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_1', crewedAt: AT });
    const switches = memoryFleetSwitches();
    await switches.set(FLEET_ID, { isEnabled: false, at: AT });
    const readFleet = createReadFleet({ isServed: createIsServed({ installation: 'enabled', switches }), connections });

    await expect(readFleet({ fleetId: FLEET_ID })).resolves.toEqual({ isEnabled: false, isConnected: true });
  });
});
