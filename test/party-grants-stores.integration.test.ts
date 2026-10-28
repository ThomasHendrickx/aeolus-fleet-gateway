import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaPartyGrants } from '../src/adapters/prisma/party-grants.js';
import { migratedDatabase } from './support/database.js';
import { JORIS_SHIP_ID, MATHILDE_SHIP_ID, aPartyGrant } from './support/party-grant-fakes.js';

// Each person's grant of a party where each person signs in (decision
// 0067), in the gateway's database: one per person and party, one per
// outside account and party, a new sign-in in place of the earlier one.

const ACME: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const LABS: FleetId = 'flt_01m4ajt7abh4rypkmdnjene67g';
const NOW = new Date('2026-10-28T14:30:00.000Z');

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

beforeEach(async () => {
  await prisma.partyGrant.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the party grants in the gateway's database", () => {
  it('keeps a grant, found by its person and by its outside account, in its fleet only', async () => {
    const grants = createPrismaPartyGrants(prisma);

    await expect(grants.keep(aPartyGrant({ fleetId: ACME }))).resolves.toBe('kept');

    await expect(
      Promise.all([grants.ofPerson(ACME, { party: 'attio', personShipId: MATHILDE_SHIP_ID }), grants.ofSubject(ACME, { party: 'attio', subject: 'sub-1' }), grants.ofPerson(LABS, { party: 'attio', personShipId: MATHILDE_SHIP_ID })]),
    ).resolves.toEqual([aPartyGrant({ fleetId: ACME }), aPartyGrant({ fleetId: ACME }), undefined]);
  });

  it("keeps a person's new grant in place of their earlier one", async () => {
    const grants = createPrismaPartyGrants(prisma);
    await grants.keep(aPartyGrant({ fleetId: ACME }));

    await grants.keep(aPartyGrant({ fleetId: ACME, accessToken: 'access-again', outsideAccount: { subject: 'sub-2', name: null } }));

    await expect(grants.ofPerson(ACME, { party: 'attio', personShipId: MATHILDE_SHIP_ID })).resolves.toEqual(aPartyGrant({ fleetId: ACME, accessToken: 'access-again', outsideAccount: { subject: 'sub-2', name: null } }));
    await expect(prisma.partyGrant.count()).resolves.toBe(1);
  });

  it("keeps no second person's grant naming the same outside account, two at once keeping one", async () => {
    const grants = createPrismaPartyGrants(prisma);

    const kept = await Promise.all([grants.keep(aPartyGrant({ fleetId: ACME })), grants.keep(aPartyGrant({ fleetId: ACME, personShipId: JORIS_SHIP_ID, accountId: 'acc-joris' }))]);

    expect(kept.sort()).toEqual(['kept', 'subjectTaken']);
    await expect(prisma.partyGrant.count()).resolves.toBe(1);
  });

  it('keeps two persons whose server gave no outside account', async () => {
    const grants = createPrismaPartyGrants(prisma);
    const unnamed = { subject: null, name: null };

    await grants.keep(aPartyGrant({ fleetId: ACME, outsideAccount: unnamed }));

    await expect(grants.keep(aPartyGrant({ fleetId: ACME, personShipId: JORIS_SHIP_ID, accountId: 'acc-joris', outsideAccount: unnamed }))).resolves.toBe('kept');
  });

  it('answers a usable grant, the most recently used first, then the most recently signed in, never one whose access token ended', async () => {
    const grants = createPrismaPartyGrants(prisma);
    await grants.keep(aPartyGrant({ fleetId: ACME, accessToken: 'used-long-ago', lastUsedAt: new Date('2026-10-20T09:00:00.000Z') }));
    await grants.keep(aPartyGrant({ fleetId: ACME, personShipId: JORIS_SHIP_ID, accountId: 'acc-joris', outsideAccount: { subject: 'sub-2', name: null }, accessToken: 'used-lately', lastUsedAt: new Date('2026-10-28T09:00:00.000Z'), accessTokenEndsAt: NOW }));
    await grants.keep(aPartyGrant({ fleetId: ACME, personShipId: 'shp_01m3tbfspe96yf1rnr4ank9chr', accountId: 'acc-charlotte', outsideAccount: { subject: 'sub-3', name: null }, accessToken: 'never-used', signedInAt: new Date('2026-10-28T14:20:00.000Z') }));

    await expect(grants.usable(ACME, { party: 'attio', now: NOW })).resolves.toMatchObject({ accessToken: 'used-long-ago' });
    await expect(grants.usable(LABS, { party: 'attio', now: NOW })).resolves.toBeUndefined();
  });

  it("removes a person's grant", async () => {
    const grants = createPrismaPartyGrants(prisma);
    await grants.keep(aPartyGrant({ fleetId: ACME }));

    await grants.remove(ACME, { party: 'attio', personShipId: MATHILDE_SHIP_ID });

    await expect(grants.ofPerson(ACME, { party: 'attio', personShipId: MATHILDE_SHIP_ID })).resolves.toBeUndefined();
  });

  it("forgets a forgotten fleet's grants", async () => {
    await createPrismaPartyGrants(prisma).keep(aPartyGrant({ fleetId: ACME }));

    await createPrismaFleetForgetter(prisma).forget(ACME);

    await expect(prisma.partyGrant.count({ where: { fleetId: ACME } })).resolves.toBe(0);
  });
});
