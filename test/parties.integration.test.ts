import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaPartyStore } from '../src/adapters/prisma/party-store.js';
import type { McpServerParty } from '../src/core/parties/party.js';
import { migratedDatabase } from './support/database.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
/** The fleet of the tool switch tests, so the list of FLEET's parties stays its own. */
const SWITCHED_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sw';
const PROXY: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9crm';
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
    concurrencyLimit: 4,
    state: 'commissioning',
    proxyShipId: null,
    secret: null,
    crewToken: null,
    requestId: 'a-1',
    requestHash: 'h',
    approvedAt: AT,
    toolSwitches: null,
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

  it('keeps a server that asks for no credential (aeolus-fleet#1153)', async () => {
    const store = createPrismaPartyStore(prisma);
    await store.save(aParty({ fleetId: SWITCHED_FLEET, name: 'vault', credential: { kind: 'none' } }));

    await expect(store.find(SWITCHED_FLEET, 'vault')).resolves.toEqual(aParty({ fleetId: SWITCHED_FLEET, name: 'vault', credential: { kind: 'none' } }));
  });

  it('keeps the tool switches a server was added with, and a save after leaves them as they are (aeolus-fleet#1151)', async () => {
    const store = createPrismaPartyStore(prisma);
    const switches = new Map([['list_contacts', true], ['create_deal', false]]);
    await store.save(aParty({ fleetId: SWITCHED_FLEET, name: 'sales', toolSwitches: switches }));
    await store.switchTools({ fleetId: SWITCHED_FLEET, name: 'sales' }, { listed: ['list_contacts', 'create_deal'], switched: new Map([['create_deal', true]]) });

    await store.save(aParty({ fleetId: SWITCHED_FLEET, name: 'sales', state: 'crewed', proxyShipId: PROXY, crewToken: 'aeolus_ct_v1_proxy', toolSwitches: switches }));

    await expect(store.find(SWITCHED_FLEET, 'sales')).resolves.toMatchObject({ state: 'crewed', toolSwitches: new Map([['list_contacts', true], ['create_deal', true]]) });
  });

  it('switches one tool of a server with no switches kept, keeping every other tool listed on', async () => {
    const store = createPrismaPartyStore(prisma);
    await store.save(aParty({ fleetId: SWITCHED_FLEET, name: 'old' }));

    await store.switchTools({ fleetId: SWITCHED_FLEET, name: 'old' }, { listed: ['list_contacts', 'create_deal'], switched: new Map([['create_deal', false]]) });

    await expect(store.find(SWITCHED_FLEET, 'old')).resolves.toMatchObject({ toolSwitches: new Map([['list_contacts', true], ['create_deal', false]]) });
  });

  it('keeps both of two switches made at once', async () => {
    const store = createPrismaPartyStore(prisma);
    await store.save(aParty({ fleetId: SWITCHED_FLEET, name: 'busy', toolSwitches: new Map([['list_contacts', true], ['create_deal', true]]) }));

    await Promise.all([
      store.switchTools({ fleetId: SWITCHED_FLEET, name: 'busy' }, { listed: ['list_contacts', 'create_deal'], switched: new Map([['list_contacts', false]]) }),
      store.switchTools({ fleetId: SWITCHED_FLEET, name: 'busy' }, { listed: ['list_contacts', 'create_deal'], switched: new Map([['create_deal', false]]) }),
    ]);

    await expect(store.find(SWITCHED_FLEET, 'busy')).resolves.toMatchObject({ toolSwitches: new Map([['list_contacts', false], ['create_deal', false]]) });
  });

  it("switches the tools of the party in its own fleet only", async () => {
    const store = createPrismaPartyStore(prisma);
    await store.save(aParty({ fleetId: SWITCHED_FLEET, name: 'shared', toolSwitches: new Map([['list_contacts', true]]) }));
    await store.save(aParty({ name: 'shared', fleetId: OTHER_FLEET, toolSwitches: new Map([['list_contacts', true]]) }));

    await store.switchTools({ fleetId: OTHER_FLEET, name: 'shared' }, { listed: ['list_contacts'], switched: new Map([['list_contacts', false]]) });

    await expect(store.find(SWITCHED_FLEET, 'shared')).resolves.toMatchObject({ toolSwitches: new Map([['list_contacts', true]]) });
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
    const { fleetId, state, proxyShipId, secret, crewToken, requestId, requestHash, approvedAt } = aParty();
    const party = { fleetId, name: 'claude', kind: 'mcpClient' as const, clientId: 'https://claude.example.com/client.json', state, proxyShipId, secret, crewToken, requestId, requestHash, approvedAt };
    await store.save(party);

    await expect(Promise.all([store.findByClient(FLEET, 'https://claude.example.com/client.json'), store.findByClient(OTHER_FLEET, 'https://claude.example.com/client.json')])).resolves.toEqual([party, undefined]);
  });

  it("keeps an A2A client party, found from any fleet by its bearer's hash alone (decision 0060)", async () => {
    const store = createPrismaPartyStore(prisma);
    const { fleetId, state, proxyShipId, secret, crewToken, requestId, requestHash, approvedAt } = aParty();
    const party = { fleetId, name: 'supplier', kind: 'a2aClient' as const, bearerHash: 'hash-of-bearer', state, proxyShipId, secret, crewToken, requestId, requestHash, approvedAt };
    await store.save(party);

    await expect(Promise.all([store.findByBearer('hash-of-bearer'), store.findByBearer('hash-of-another')])).resolves.toEqual([party, undefined]);
  });

  it('keeps an A2A agent party with its card address, credential, calls at once and repeatable mark (slice 5)', async () => {
    const store = createPrismaPartyStore(prisma);
    const { state, proxyShipId, secret, crewToken, requestId, requestHash, approvedAt } = aParty();
    const agent = { fleetId: SWITCHED_FLEET, name: 'quotes', kind: 'a2aAgent' as const, cardUrl: 'https://agent.supplier.example/.well-known/agent-card.json', credential: { kind: 'bearer' as const, token: 'tok-1' }, concurrencyLimit: 3, isRepeatable: true, state, proxyShipId, secret, crewToken, requestId, requestHash, approvedAt };
    await store.save(agent);
    await store.save({ ...agent, isRepeatable: false });

    await expect(store.find(SWITCHED_FLEET, 'quotes')).resolves.toEqual({ ...agent, isRepeatable: false });
  });

  it('forgets a fleet with its parties and their credentials (decision 0021)', async () => {
    const store = createPrismaPartyStore(prisma);
    await store.save(aParty({ fleetId: OTHER_FLEET, name: 'ledger' }));

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    await expect(store.list(OTHER_FLEET)).resolves.toEqual([]);
  });
});
