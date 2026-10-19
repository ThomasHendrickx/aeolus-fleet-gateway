import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaPartyStore } from '../src/adapters/prisma/party-store.js';
import type { McpServerParty, PersonParty } from '../src/core/parties/party.js';
import { migratedDatabase } from './support/database.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const OWNER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9wnr';
const PROXY: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9crm';
const CHARLOTTE: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9chr';
const AT = new Date('2026-10-18T13:00:00.000Z');

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

function aParty(overrides: Partial<McpServerParty> = {}): McpServerParty {
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

  it('keeps an MCP client party, found by its client id', async () => {
    const store = createPrismaPartyStore(prisma);
    const { fleetId, ownerShipId, state, proxyShipId, secret, crewToken, requestId, requestHash, approvedAt } = aParty();
    const party = { fleetId, name: 'claude', kind: 'mcpClient' as const, clientId: 'https://claude.example.com/client.json', ownerShipId, state, proxyShipId, secret, crewToken, requestId, requestHash, approvedAt };
    await store.save(party);

    await expect(Promise.all([store.findByClient(FLEET, 'https://claude.example.com/client.json'), store.findByClient(OTHER_FLEET, 'https://claude.example.com/client.json')])).resolves.toEqual([party, undefined]);
  });

  it('keeps a person, found by their email, and bound to a sign-in later', async () => {
    const store = createPrismaPartyStore(prisma);
    const charlotte: PersonParty = {
      fleetId: FLEET,
      name: 'charlotte',
      kind: 'person',
      email: 'charlotte@example.com',
      issuer: null,
      subject: null,
      ownerShipId: CHARLOTTE,
      state: 'crewed',
      proxyShipId: CHARLOTTE,
      secret: null,
      crewToken: 'aeolus_ct_v1_charlotte',
      requestId: CHARLOTTE,
      requestHash: '',
      approvedAt: AT,
    };
    await store.save(charlotte);
    await expect(store.findPersonByEmail(FLEET, 'charlotte@example.com')).resolves.toEqual(charlotte);

    await store.save({ ...charlotte, issuer: 'https://accounts.google.com', subject: '1078' });

    await expect(store.findPersonByEmail(FLEET, 'charlotte@example.com')).resolves.toMatchObject({ issuer: 'https://accounts.google.com', subject: '1078' });
    await expect(store.findPersonByEmail(OTHER_FLEET, 'charlotte@example.com')).resolves.toBeUndefined();
  });

  it('forgets a fleet with its parties and their credentials (decision 0021)', async () => {
    const store = createPrismaPartyStore(prisma);
    await store.save(aParty({ fleetId: OTHER_FLEET, name: 'ledger' }));

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    await expect(store.list(OTHER_FLEET)).resolves.toEqual([]);
  });
});
