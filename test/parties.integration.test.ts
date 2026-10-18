import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaPartyStore } from '../src/adapters/prisma/party-store.js';
import type { Party } from '../src/core/parties/party.js';
import { migratedDatabase } from './support/database.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const OWNER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9own';
const PROXY: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9crm';
const AT = new Date('2026-10-18T13:00:00.000Z');

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

function aParty(overrides: Partial<Party> = {}): Party {
  return {
    fleetId: FLEET,
    name: 'crm',
    kind: 'mcpServer',
    url: 'https://crm.example.com/mcp',
    credential: { kind: 'clientCredentials', clientId: 'gw', clientSecret: 's', issuer: 'https://auth.example.com', scope: 'crm.read' },
    ownerShipId: OWNER,
    concurrencyLimit: 4,
    state: 'commissioning',
    proxyShipId: null,
    secret: null,
    crewToken: null,
    requestId: 'a-1',
    requestHash: 'h',
    approvedAt: AT,
    ...overrides,
  };
}

describe("the gateway's parties and their vault in Postgres", () => {
  it('keeps a party with its credential, and each step after it', async () => {
    const store = createPrismaPartyStore(prisma);
    await store.save(aParty());
    await store.save(aParty({ state: 'awaitingCrew', proxyShipId: PROXY, secret: 'aeolus_sk_v1_proxy' }));
    await store.save(aParty({ state: 'crewed', proxyShipId: PROXY, crewToken: 'aeolus_ct_v1_proxy' }));

    await expect(store.find(FLEET, 'crm')).resolves.toEqual(aParty({ state: 'crewed', proxyShipId: PROXY, crewToken: 'aeolus_ct_v1_proxy' }));
  });

  it("lists one fleet's parties, and removes one", async () => {
    const store = createPrismaPartyStore(prisma);
    await store.save(aParty({ name: 'erp', credential: { kind: 'bearer', token: 't' } }));
    await store.save(aParty({ name: 'crm', fleetId: OTHER_FLEET }));
    await store.remove(FLEET, 'crm');

    await expect(store.list(FLEET).then((parties) => parties.map((party) => party.name))).resolves.toEqual(['erp']);
  });

  it('forgets a fleet with its parties and their credentials (decision 0021)', async () => {
    const store = createPrismaPartyStore(prisma);
    await store.save(aParty({ fleetId: OTHER_FLEET, name: 'ledger' }));

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    await expect(store.list(OTHER_FLEET)).resolves.toEqual([]);
  });
});
