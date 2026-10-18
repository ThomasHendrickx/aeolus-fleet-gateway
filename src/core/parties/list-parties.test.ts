import { describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { OWNER_SHIP_ID, PROXY_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import type { Party } from './party.js';
import { createListParties } from './list-parties.js';

const AT = new Date('2026-10-18T13:00:00.000Z');

function aParty(overrides: Partial<Party>): Party {
  return {
    fleetId: FLEET_ID,
    name: 'crm',
    kind: 'mcpServer',
    url: 'https://crm.example.com/mcp',
    credential: { kind: 'bearer', token: 'crm-token' },
    ownerShipId: OWNER_SHIP_ID,
    concurrencyLimit: 4,
    state: 'crewed',
    proxyShipId: PROXY_SHIP_ID,
    secret: null,
    crewToken: 'aeolus_ct_v1_proxy',
    requestId: 'a-1',
    requestHash: 'h',
    approvedAt: AT,
    ...overrides,
  };
}

describe("argo reads its fleet's parties", () => {
  it("lists its fleet's parties by name, never another fleet's, without their credential or crew token", async () => {
    const parties = memoryPartyStore();
    await parties.save(aParty({ name: 'erp' }));
    await parties.save(aParty({ name: 'crm' }));
    await parties.save(aParty({ name: 'other', fleetId: OTHER_FLEET_ID }));

    await expect(createListParties({ parties })(FLEET_ID)).resolves.toEqual([
      { name: 'crm', kind: 'mcpServer', url: 'https://crm.example.com/mcp', credentialKind: 'bearer', ownerShipId: OWNER_SHIP_ID, concurrencyLimit: 4, state: 'crewed', proxyShipId: PROXY_SHIP_ID },
      { name: 'erp', kind: 'mcpServer', url: 'https://crm.example.com/mcp', credentialKind: 'bearer', ownerShipId: OWNER_SHIP_ID, concurrencyLimit: 4, state: 'crewed', proxyShipId: PROXY_SHIP_ID },
    ]);
  });
});
