import { describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { memoryFleetSwitches } from '../../../test/support/memory-installation.js';
import { createIsServed } from './served.js';

describe('which fleets the gateway serves (decision 0021)', () => {
  it('serves every fleet of an open installation', async () => {
    await expect(createIsServed({ installation: 'open', switches: memoryFleetSwitches() })(FLEET_ID)).resolves.toBe(true);
  });

  it('serves a fleet of an enabled installation only once it was switched on', async () => {
    const switches = memoryFleetSwitches();
    await switches.set(FLEET_ID, { isEnabled: true, at: new Date('2026-10-18T12:00:00.000Z') });
    const isServed = createIsServed({ installation: 'enabled', switches });

    await expect(Promise.all([isServed(FLEET_ID), isServed(OTHER_FLEET_ID)])).resolves.toEqual([true, false]);
  });

  it('stops serving a fleet switched off again', async () => {
    const switches = memoryFleetSwitches();
    await switches.set(FLEET_ID, { isEnabled: false, at: new Date('2026-10-18T12:00:00.000Z') });

    await expect(createIsServed({ installation: 'enabled', switches })(FLEET_ID)).resolves.toBe(false);
  });
});
