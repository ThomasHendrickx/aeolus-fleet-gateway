import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createFleetRetention } from '../src/adapters/fleet/fleet-retention.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { commission, register, signIn } from './support/argo.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';

// A client showing a person ship's exchange tells where its history ends
// (aeolus-fleet-gateway #321): the fleet's retention as the real core answers
// it to the gateway's ship, a fleet at a time.

let fleet: FleetServer;
let core: PrismaClient;
let readerToken: string;

beforeAll(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  core = createPrismaClient(fleet.databaseUrl);
  const cookie = await signIn(fleet);
  readerToken = await register(fleet, await commission(fleet, { cookie, ship: { name: 'reader', type: 'agent', scopes: ['fleet:read'] } }));
});

afterAll(async () => {
  await core.$disconnect();
  await fleet.stop();
});

describe("the fleet's retention, as core answers it", () => {
  it('is no days and no keptFrom while the fleet keeps its history for good', async () => {
    await expect(createFleetRetention(fleet.url).retention({ crewToken: readerToken })).resolves.toEqual({ isOk: true, value: { days: null, keptFrom: null } });
  });

  it('is the fleet\'s days and from when its messages are kept once core pruned', async () => {
    await core.$executeRaw`UPDATE "fleets" SET "retention_set" = true, "retention_days" = 30, "kept_from" = '2026-10-02T09:01:03.000Z'`;

    await expect(createFleetRetention(fleet.url).retention({ crewToken: readerToken })).resolves.toEqual({ isOk: true, value: { days: 30, keptFrom: '2026-10-02T09:01:03.000Z' } });
  });

  it('is refused to a ship that does not hold fleet:read', async () => {
    const cookie = await signIn(fleet);
    const outsider = await register(fleet, await commission(fleet, { cookie, ship: { name: 'outsider', type: 'agent', scopes: [] } }));

    await expect(createFleetRetention(fleet.url).retention({ crewToken: outsider })).resolves.toMatchObject({ isOk: false, error: { code: 'FORBIDDEN' } });
  });
});
