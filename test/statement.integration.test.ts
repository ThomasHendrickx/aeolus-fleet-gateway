import { discoverOutputSchema, type FleetId } from '@aeolus-fleet/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaToolMarks } from '../src/adapters/prisma/tool-marks.js';
import { statementOf } from '../src/core/mcp-out/statement.js';
import { commission, register, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';

describe("a proxy ship's statement, stated through the fleet's REST API", () => {
  let fleet: FleetServer;

  beforeEach(async () => {
    fleet = await startFleetServer(inject('postgresUrl'));
  });

  afterEach(async () => {
    await fleet.stop();
  });

  it("is what discovery shows of the proxy ship: its server's tools as capabilities", async () => {
    const cookie = await signIn(fleet);
    const proxy = await register(fleet, await commission(fleet, { cookie, ship: { name: 'crm', type: 'mcp-server', kind: 'app' } }));
    const caller = await register(fleet, await commission(fleet, { cookie, ship: { name: 'agent', type: 'agent', scopes: ['messages:send'] } }));
    // Without the fields core 0.27 does not know yet (annotations, repeatable: aeolus-fleet#956).
    const statement = statementOf({ partyName: 'crm', tools: [{ name: 'list_deals', title: 'List deals', inputSchema: { type: 'object' } }], repeatable: new Set() });

    await expect(createRestFleetDoor(fleet.url).setStatement(proxy, statement)).resolves.toEqual({ isOk: true, value: undefined });

    const discovered = discoverOutputSchema.parse(await (await fetch(`${fleet.url}/api/v1/ship/discover`, { headers: { authorization: `Bearer ${caller}` } })).json());
    expect(discovered.ships.find((ship) => ship.name === 'crm')?.statement).toEqual({ by: 'crew', version: 1, ...statement });
  });

  it("answers the fleet's refusal", async () => {
    const stated = await createRestFleetDoor(fleet.url).setStatement('aeolus_ct_v1_not-a-crew-token', statementOf({ partyName: 'crm', tools: [], repeatable: new Set() }));

    expect(stated.isOk).toBe(false);
  });
});

describe("argo's repeatable marks in Postgres", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('keeps the marked tools of each party, and takes a mark off', async () => {
    const marks = createPrismaToolMarks(prisma);
    await marks.mark(FLEET, { party: 'crm', tool: 'create_deal', isRepeatable: true });
    await marks.mark(FLEET, { party: 'crm', tool: 'list_deals', isRepeatable: true });
    await marks.mark(FLEET, { party: 'crm', tool: 'create_deal', isRepeatable: true });
    await marks.mark(FLEET, { party: 'erp', tool: 'post_invoice', isRepeatable: true });
    await marks.mark(FLEET, { party: 'crm', tool: 'list_deals', isRepeatable: false });
    await marks.mark(FLEET, { party: 'crm', tool: 'never_marked', isRepeatable: false });

    await expect(marks.repeatable(FLEET, 'crm')).resolves.toEqual(new Set(['create_deal']));
  });

  it('forgets a fleet with its marks (decision 0021)', async () => {
    const marks = createPrismaToolMarks(prisma);
    await marks.mark(OTHER_FLEET, { party: 'crm', tool: 'create_deal', isRepeatable: true });

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    await expect(marks.repeatable(OTHER_FLEET, 'crm')).resolves.toEqual(new Set());
  });
});
