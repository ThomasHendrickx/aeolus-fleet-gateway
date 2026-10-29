import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { CRM_SHIP_ID, aDiscoveredShip, fakeAliases, fakeDiscovery } from '../../../test/support/mcp-in-fakes.js';
import { PROXY_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import { createFindReachedShip } from './find-reached-ship.js';
import { createListReachedShips } from './list-reached-ships.js';

const AT = new Date('2026-10-23T10:00:00.000Z');
const CRM_ALIAS = `a${CRM_SHIP_ID.slice(-4)}`;
const CALLER = { fleetId: FLEET_ID, party: 'supplier' };

let discovery: ReturnType<typeof fakeDiscovery>;
let find: ReturnType<typeof createFindReachedShip>;

beforeEach(async () => {
  const parties = memoryPartyStore();
  await parties.save({ fleetId: FLEET_ID, name: 'supplier', kind: 'a2aClient', bearerHash: 'h(b)', state: 'crewed', proxyShipId: PROXY_SHIP_ID, secret: null, crewToken: 'aeolus_ct_v1_proxy', requestId: 'r-1', requestHash: 'h', approvedAt: AT });
  discovery = fakeDiscovery();
  find = createFindReachedShip({ listReachedShips: createListReachedShips({ parties, discovery, aliases: fakeAliases }) });
});

describe('an alias names a ship the A2A client reaches now (decision 0060)', () => {
  it('answers the ship whose alias matches, with its statement', async () => {
    await expect(find({ ...CALLER, alias: CRM_ALIAS })).resolves.toEqual({ isOk: true, value: { shipId: CRM_SHIP_ID, alias: CRM_ALIAS, statement: aDiscoveredShip().statement } });
  });

  it('refuses an alias of no ship with the unknown-alias error', async () => {
    await expect(find({ ...CALLER, alias: 'azzzzzzz' })).resolves.toMatchObject({ isOk: false, error: { kind: 'UNKNOWN_ALIAS' } });
  });

  it('refuses an alias of a ship the client cannot reach now with the same error, so it learns nothing of it', async () => {
    discovery.state.ships = [];

    await expect(find({ ...CALLER, alias: CRM_ALIAS })).resolves.toEqual(await find({ ...CALLER, alias: 'azzzzzzz' }));
  });
});
