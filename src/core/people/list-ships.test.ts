import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { CHARLOTTE_GRANT, fakeCrewPersonShip, fakePersonShipDoor, memoryPersonCrews } from '../../../test/support/people-fakes.js';
import { createListShips } from './list-ships.js';
import type { PersonDiscovery } from './ports.js';

// A person reads, from their MCP client, the ships and types their person
// ship may send to now, with what each offers: the fleet's discover, as the
// person ship, so their rights alone decide it (aeolus-fleet #1046).

/** What the fleet's discover answers Charlotte's person ship. */
const DISCOVERY: PersonDiscovery = {
  ships: [
    {
      name: 'tracker',
      type: 'issue-tracker',
      kind: 'app',
      statement: { by: 'crew', summary: 'The issue tracker', capabilities: [{ name: 'open-issue', description: 'Opens an issue' }] },
    },
    { name: 'dirk', type: 'person', kind: 'person', statement: null },
  ],
  types: [{ type: 'issue-tracker', reachable: 1 }],
};

let crews: ReturnType<typeof memoryPersonCrews>;

beforeEach(() => {
  crews = memoryPersonCrews();
});

function listing() {
  const ship = fakePersonShipDoor({ crewToken: 'aeolus_ct_v1_charlotte', deliveries: [], discovery: DISCOVERY });
  return { ...ship, listShips: createListShips({ crewPersonShip: fakeCrewPersonShip(crews), crews, door: ship.door }) };
}

describe('a person reads the ships they may send to', () => {
  it("answers exactly what the fleet's discover answers their person ship: each ship's name, type, kind and statement, and each type", async () => {
    const { listShips } = listing();

    await expect(listShips(CHARLOTTE_GRANT)).resolves.toEqual({ isOk: true, value: DISCOVERY });
  });

  it("says why when the fleet refuses their person ship's discover", async () => {
    const { listShips, refusals } = listing();
    refusals.discover.push({ code: 'FORBIDDEN', message: 'discover needs the messages:send scope' });

    await expect(listShips(CHARLOTTE_GRANT)).resolves.toEqual({
      isOk: false,
      error: { kind: 'SEND_REFUSED', message: 'The fleet did not say what you may send to: discover needs the messages:send scope' },
    });
  });

  it('refuses an account with no person ship, asking the fleet nothing', async () => {
    const { listShips, calls } = listing();

    await expect(listShips({ fleetId: FLEET_ID, grantId: 'grant-2' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_PERSON' } });
    expect(calls).toEqual([]);
  });
});
