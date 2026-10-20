import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { fakeProxyShipReads, OWNER_SHIP_ID, PROXY_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import type { McpServerParty } from './party.js';
import { createListParties, createReadParty } from './list-parties.js';

// The fleet's outside parties as an actor reads them: never a credential, a
// secret or a crew token. Each proxy ship's owner and scopes are core's
// alone (decision 0056), read as the gateway's ship; the gateway keeps no
// owner of its own.

const AT = new Date('2026-10-18T13:00:00.000Z');
const GATEWAY_CREW = 'aeolus_ct_v1_gateway';
const ERP_SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9erp';

function aParty(overrides: Partial<McpServerParty>): McpServerParty {
  return {
    fleetId: FLEET_ID,
    name: 'crm',
    kind: 'mcpServer',
    url: 'https://crm.example.com/mcp',
    credential: { kind: 'bearer', token: 'crm-token' },
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

let parties: ReturnType<typeof memoryPartyStore>;
let connections: ReturnType<typeof memoryConnectionStore>;

beforeEach(async () => {
  parties = memoryPartyStore();
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: GATEWAY_CREW, crewedAt: AT });
});

const reads = () => fakeProxyShipReads({ [PROXY_SHIP_ID]: { ownerShipId: OWNER_SHIP_ID, scopes: ['messages:send', 'messages:receive', 'fleet:read'] }, [ERP_SHIP_ID]: { ownerShipId: null, scopes: ['messages:send'] } });

describe("an actor reads its fleet's outside parties", () => {
  it("lists its fleet's parties by name, never another fleet's, each with the owner and scopes the fleet holds for its proxy ship", async () => {
    await parties.save(aParty({ name: 'erp', proxyShipId: ERP_SHIP_ID }));
    await parties.save(aParty({ name: 'crm' }));
    await parties.save(aParty({ name: 'other', fleetId: OTHER_FLEET_ID }));
    const fleet = reads();

    await expect(createListParties({ parties, connections, fleet })(FLEET_ID)).resolves.toEqual([
      { name: 'crm', kind: 'mcpServer', url: 'https://crm.example.com/mcp', credentialKind: 'bearer', concurrencyLimit: 4, state: 'crewed', proxyShipId: PROXY_SHIP_ID, ownerShipId: OWNER_SHIP_ID, scopes: ['messages:send', 'messages:receive', 'fleet:read'] },
      { name: 'erp', kind: 'mcpServer', url: 'https://crm.example.com/mcp', credentialKind: 'bearer', concurrencyLimit: 4, state: 'crewed', proxyShipId: ERP_SHIP_ID, ownerShipId: null, scopes: ['messages:send'] },
    ]);
    expect(fleet.readers).toEqual([GATEWAY_CREW, GATEWAY_CREW]);
  });

  it('knows no owner or scopes of a party whose proxy ship is not commissioned yet, asking the fleet nothing', async () => {
    await parties.save(aParty({ state: 'commissioning', proxyShipId: null, crewToken: null }));
    const fleet = reads();

    await expect(createListParties({ parties, connections, fleet })(FLEET_ID)).resolves.toMatchObject([{ name: 'crm', ownerShipId: null, scopes: null }]);
    expect(fleet.readers).toEqual([]);
  });

  it('knows no owner or scopes while the fleet does not answer, or the gateway is not connected', async () => {
    await parties.save(aParty({}));
    const silent = await createListParties({ parties, connections, fleet: fakeProxyShipReads({}) })(FLEET_ID);
    await connections.drop(FLEET_ID);

    const unconnected = await createListParties({ parties, connections, fleet: reads() })(FLEET_ID);

    expect({ silent, unconnected }).toMatchObject({ silent: [{ ownerShipId: null, scopes: null }], unconnected: [{ ownerShipId: null, scopes: null }] });
  });
});

describe('an actor reads one outside party', () => {
  it('reads it by name, with its owner and scopes from the fleet', async () => {
    await parties.save(aParty({}));

    await expect(createReadParty({ parties, connections, fleet: reads() })({ fleetId: FLEET_ID, name: 'crm' })).resolves.toMatchObject({ isOk: true, value: { name: 'crm', ownerShipId: OWNER_SHIP_ID, scopes: ['messages:send', 'messages:receive', 'fleet:read'] } });
  });

  it('refuses a party the gateway does not know', async () => {
    await expect(createReadParty({ parties, connections, fleet: reads() })({ fleetId: FLEET_ID, name: 'nobody' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_PARTY' } });
  });
});
