import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createActiveShips } from '../src/adapters/fleet/active-ships.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { commission, register, signIn } from './support/argo.js';
import { startFleetServer, type FleetServer } from './support/fleet-server.js';

// The sidebar's alert count on every Bridge page (aeolus-fleet-gateway #233):
// one read of core's Harbour numbers in a fleet of 3,000 active ships, never
// a read of every ship. Each run prints p50 and p95 of the count and of the
// listing it replaces.

const ACTIVE_SHIPS = 3_000;
const LOOKS = 20;
const SETUP_TIMEOUT_MS = 600_000;
/** The budget of a read (performance): p95 under 100 ms. */
const P95_LIMIT_MS = 100;

let fleet: FleetServer;
let core: PrismaClient;
let readerToken: string;

beforeAll(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  core = createPrismaClient(fleet.databaseUrl);
  const cookie = await signIn(fleet);
  readerToken = await register(fleet, await commission(fleet, { cookie, ship: { name: 'reader', type: 'agent', scopes: ['fleet:read'] } }));
  const [fleetRow] = await core.$queryRaw<{ id: string }[]>`SELECT "id" FROM "fleets" LIMIT 1`;
  await core.$executeRaw`
    INSERT INTO ships (id, fleet_id, name, type, created_at, kind, scopes)
    SELECT 'shp_2' || lpad(i::text, 25, '0'), ${fleetRow?.id}, 'active-' || i, 'agent', now(), 'agent', '{}'
    FROM generate_series(1, ${ACTIVE_SHIPS}::int) i`;
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await core.$disconnect();
  await fleet.stop();
});

function percentile(sorted: readonly number[], share: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)] ?? 0;
}

async function timed(look: () => Promise<unknown>): Promise<{ p50: number; p95: number }> {
  const durations: number[] = [];
  for (let each = 0; each < LOOKS; each += 1) {
    const startedAt = performance.now();
    await look();
    durations.push(performance.now() - startedAt);
  }
  const sorted = durations.toSorted((a, b) => a - b);
  return { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
}

describe('the count of ships with an alert, in a fleet of 3,000 active ships', () => {
  it("is the number core counts, and reads within the budget of one read, however many ships there are", async () => {
    const ships = createActiveShips(fleet.url);
    const as = { crewToken: readerToken };
    const listed = await ships.list(as);
    const counted = await ships.alertCount(as);

    const count = await timed(() => ships.alertCount(as));
    const listing = await timed(() => ships.list(as));
    console.info(JSON.stringify({ ships: ACTIVE_SHIPS, 'count p50 ms': Math.round(count.p50), 'count p95 ms': Math.round(count.p95), 'listing p50 ms': Math.round(listing.p50), 'listing p95 ms': Math.round(listing.p95) }));

    expect(listed.isOk ? listed.value.length : 0).toBeGreaterThanOrEqual(ACTIVE_SHIPS);
    expect(counted).toEqual({ isOk: true, value: listed.isOk ? listed.value.filter(({ state }) => state === 'alert').length : -1 });
    expect(count.p95).toBeLessThan(P95_LIMIT_MS);
  });
});
