import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { CHARLOTTE_GRANT, fakeCrewPersonShip, fakePersonShipDoor, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import type { PersonDiscovery } from './ports.js';
import { createReadSendTo } from './read-send-to.js';

// Bridge's form to send a ship a message (aeolus-fleet #1547): the ships the
// person ship may send to now, as the fleet's discover answers it, and the
// person ship's own name, which the message is sent as.

/** What the fleet's discover answers Charlotte's person ship. */
const DISCOVERY: PersonDiscovery = {
  ships: [
    { id: 'shp_01m3tbfspe96yf1rnr4ank9h1a', name: 'tracker', type: 'issue-tracker', kind: 'app', statement: null },
    { id: 'shp_01m3tbfspe96yf1rnr4ank9trk', name: 'builder-core', type: 'builder', kind: 'agent', statement: null },
  ],
  types: [
    { type: 'issue-tracker', reachable: 1 },
    { type: 'builder', reachable: 1 },
  ],
};

let crews: ReturnType<typeof memoryPersonCrews>;

beforeEach(() => {
  crews = memoryPersonCrews();
});

function reading() {
  const ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', name: 'charlotte', deliveries: [], discovery: DISCOVERY });
  return { ...ship, readSendTo: createReadSendTo({ crewPersonShip: fakeCrewPersonShip(crews), crews, door: ship.door }) };
}

describe('a person reads who they can send a message to in Bridge', () => {
  it('answers the ships the fleet says their person ship may send to, by name with its id, and the name it sends as', async () => {
    const { readSendTo } = reading();

    await expect(readSendTo(CHARLOTTE_GRANT)).resolves.toEqual({ isOk: true, value: { sentAs: 'charlotte', ships: [{ id: 'shp_01m3tbfspe96yf1rnr4ank9trk', name: 'builder-core' }, { id: 'shp_01m3tbfspe96yf1rnr4ank9h1a', name: 'tracker' }] } });
  });

  it("says why when the fleet refuses their person ship's discover", async () => {
    const { readSendTo, refusals } = reading();
    refusals.discover.push({ code: 'FORBIDDEN', message: 'The ship does not hold messages:send' });

    await expect(readSendTo(CHARLOTTE_GRANT)).resolves.toEqual({
      isOk: false,
      error: { kind: 'SEND_REFUSED', message: 'The fleet did not say what you may send to: The ship does not hold messages:send' },
    });
  });

  it('says the fleet did not answer when it gives no answer', async () => {
    const { readSendTo, refusals } = reading();
    refusals.whoami.push({ code: 'UNAVAILABLE', message: 'The fleet did not answer: fetch failed' });

    await expect(readSendTo(CHARLOTTE_GRANT)).resolves.toEqual({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE', message: 'The fleet did not answer: fetch failed' } });
  });

  it('refuses an account with no person ship, asking the fleet nothing', async () => {
    const { readSendTo, calls } = reading();

    await expect(readSendTo({ fleetId: FLEET_ID, grantId: 'grant-2' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_PERSON' } });
    expect(calls).toEqual([]);
  });
});
