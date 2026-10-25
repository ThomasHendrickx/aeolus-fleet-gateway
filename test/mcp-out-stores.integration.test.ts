import { discoverOutputSchema, type FleetId } from '@aeolus-fleet/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaCalls } from '../src/adapters/prisma/calls.js';
import { createPrismaToolMarks } from '../src/adapters/prisma/tool-marks.js';
import { statementOf } from '../src/core/mcp-out/statement.js';
import { NO_SCOPE_REQUIREMENTS } from '../src/core/parties/scope-requirements.js';
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
    const statement = statementOf({ partyName: 'crm', tools: [{ name: 'list_deals', title: 'List deals', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }], repeatable: new Set(['list_deals']), timing: { waitMs: 10_000, deadlineMs: 300_000 }, requirements: NO_SCOPE_REQUIREMENTS });

    await expect(createRestFleetDoor(fleet.url).setStatement(proxy, statement)).resolves.toEqual({ isOk: true, value: undefined });

    const discovered = discoverOutputSchema.parse(await (await fetch(`${fleet.url}/api/v1/ship/discover`, { headers: { authorization: `Bearer ${caller}` } })).json());
    expect(discovered.ships.find((ship) => ship.name === 'crm')?.statement).toEqual({ by: 'crew', version: 1, ...statement });
  });

  it("answers the fleet's refusal", async () => {
    const stated = await createRestFleetDoor(fleet.url).setStatement('aeolus_ct_v1_not-a-crew-token', statementOf({ partyName: 'crm', tools: [], repeatable: new Set(), timing: { waitMs: 10_000, deadlineMs: 300_000 }, requirements: NO_SCOPE_REQUIREMENTS }));

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

describe("the gateway's calls in Postgres", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const REPLY = { to: 'shp_01m3tbfspe96yf1rnr4ank9agt', inReplyTo: 'msg_01m3tbfspe96yf1rnr4ank9m01', contentType: 'application/vnd.aeolus.mcp-result+json; name=list_deals', payload: '{}', idempotencyKey: 'mcp-result:msg_01m3tbfspe96yf1rnr4ank9m01' } as const;

  it('keeps each call by delivery, with its reply until it is sent', async () => {
    const calls = createPrismaCalls(prisma);
    await calls.save({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9d01', fleetId: FLEET, party: 'crm', state: 'calling', reply: null });
    await calls.save({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9d01', fleetId: FLEET, party: 'crm', state: 'answered', reply: REPLY });

    await expect(calls.find('dlv_01m3tbfspe96yf1rnr4ank9d01')).resolves.toEqual({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9d01', fleetId: FLEET, party: 'crm', state: 'answered', reply: REPLY });
    await expect(calls.find('dlv_01m3tbfspe96yf1rnr4ank9d09')).resolves.toBeUndefined();
  });

  it('forgets a fleet with its calls (decision 0021)', async () => {
    const calls = createPrismaCalls(prisma);
    await calls.save({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank9d02', fleetId: OTHER_FLEET, party: 'crm', state: 'mayHaveRun', reply: null });

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    await expect(calls.find('dlv_01m3tbfspe96yf1rnr4ank9d02')).resolves.toBeUndefined();
  });
});
