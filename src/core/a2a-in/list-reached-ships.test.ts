import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { ARGO_SHIP_ID, CRM_SHIP_ID, aDiscoveredShip, fakeAliases, fakeDiscovery } from '../../../test/support/mcp-in-fakes.js';
import { PROXY_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import { createListReachedShips } from './list-reached-ships.js';

const AT = new Date('2026-10-23T10:00:00.000Z');
const LEDGER_SHIP_ID = 'shp_01m3tbfspe96yf1rnr4ank9led';

let parties: ReturnType<typeof memoryPartyStore>;
let discovery: ReturnType<typeof fakeDiscovery>;
let list: ReturnType<typeof createListReachedShips>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save({ fleetId: FLEET_ID, name: 'supplier', kind: 'a2aClient', bearerHash: 'h(b)', state: 'crewed', proxyShipId: PROXY_SHIP_ID, secret: null, crewToken: 'aeolus_ct_v1_proxy', requestId: 'r-1', requestHash: 'h', approvedAt: AT });
  discovery = fakeDiscovery([aDiscoveredShip(), aDiscoveredShip({ shipId: LEDGER_SHIP_ID, statement: null }), aDiscoveredShip({ shipId: ARGO_SHIP_ID, kind: 'operator', statement: null })]);
  list = createListReachedShips({ parties, discovery, aliases: fakeAliases });
});

describe("the ships an A2A client reaches are those the fleet's discover answers its proxy ship (decision 0060)", () => {
  it('answers each by its alias with its statement, asking as the proxy ship', async () => {
    await expect(list({ fleetId: FLEET_ID, party: 'supplier' })).resolves.toEqual({
      isOk: true,
      value: [
        { alias: `a${CRM_SHIP_ID.slice(-4)}`, statement: aDiscoveredShip().statement },
        { alias: 'a9led', statement: null },
      ],
    });
    expect(discovery.askedWith).toEqual(['aeolus_ct_v1_proxy']);
  });

  it('leaves argo out: every ship may send to argo, and argo is no card', async () => {
    const listed = await list({ fleetId: FLEET_ID, party: 'supplier' });

    expect(listed.isOk && listed.value.map((ship) => ship.alias)).not.toContain('a9arg');
  });

  it('refuses a party that is not a crewed A2A client', async () => {
    await expect(list({ fleetId: FLEET_ID, party: 'claude' })).resolves.toMatchObject({ isOk: false, error: { kind: 'PARTY_NOT_CREWED' } });
  });

  it('refuses when the fleet does not answer', async () => {
    discovery.state.refusal = { code: 'UNAVAILABLE', message: 'down' };

    await expect(list({ fleetId: FLEET_ID, party: 'supplier' })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});
