import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaPartyGrants } from '../src/adapters/prisma/party-grants.js';
import { createPrismaSignInNotices } from '../src/adapters/prisma/sign-in-notices.js';
import { migratedDatabase } from './support/database.js';
import type { PartyGrant } from '../src/core/party-grants/party-grant.js';
import { JORIS_SHIP_ID, MATHILDE_SHIP_ID, aPartyGrant } from './support/party-grant-fakes.js';

// Each person's grant of a party where each person signs in (decision
// 0067), in the gateway's database: one per person and party, one per
// outside account and party, a new sign-in in place of the earlier one; and
// the notices that told a person a call needed their sign-in.

const ACME: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const LABS: FleetId = 'flt_01m4ajt7abh4rypkmdnjene67g';
const NOW = new Date('2026-10-28T14:30:00.000Z');
/** How long each change holds the grant: long enough that the two overlap. */
const CHANGE_WAIT_MS = 200;

let databaseUrl: string;
let prisma: PrismaClient;

beforeAll(async () => {
  databaseUrl = await migratedDatabase(inject('postgresUrl'));
  prisma = createPrismaClient(databaseUrl);
});

beforeEach(async () => {
  await prisma.partyGrant.deleteMany({});
  await prisma.partySignInNotice.deleteMany({});
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

  it('keeps the grant a change answers', async () => {
    const grants = createPrismaPartyGrants(prisma);
    await grants.keep(aPartyGrant({ fleetId: ACME }));
    const refreshed = aPartyGrant({ fleetId: ACME, accessToken: 'access-2', refreshToken: 'refresh-2', accessTokenEndsAt: new Date('2026-10-28T16:00:00.000Z') });

    await expect(grants.change(aPartyGrant({ fleetId: ACME }), () => Promise.resolve(refreshed))).resolves.toEqual(refreshed);

    await expect(grants.ofPerson(ACME, { party: 'attio', personShipId: MATHILDE_SHIP_ID })).resolves.toEqual(refreshed);
  });

  it('changes nothing and answers none for a person who holds no grant of the party', async () => {
    const grants = createPrismaPartyGrants(prisma);

    await expect(grants.change(aPartyGrant({ fleetId: ACME }), () => Promise.resolve(aPartyGrant({ fleetId: ACME })))).resolves.toBeUndefined();

    await expect(grants.ofPerson(ACME, { party: 'attio', personShipId: MATHILDE_SHIP_ID })).resolves.toBeUndefined();
  });

  it('runs one change at a time on a grant, also from two gateway instances: the second reads what the first kept', async () => {
    const other = createPrismaClient(databaseUrl);
    const [one, two] = [createPrismaPartyGrants(prisma), createPrismaPartyGrants(other)];
    await one.keep(aPartyGrant({ fleetId: ACME, accessToken: 'access-0' }));
    const seen = new Array<string>();
    const next = async (held: PartyGrant) => {
      seen.push(held.accessToken);
      await new Promise((resolve) => setTimeout(resolve, CHANGE_WAIT_MS));
      return { ...held, accessToken: `access-${String(seen.length)}` };
    };

    await Promise.all([one.change(aPartyGrant({ fleetId: ACME }), next), two.change(aPartyGrant({ fleetId: ACME }), next)]);
    await other.$disconnect();

    expect(seen).toEqual(['access-0', 'access-1']);
    await expect(one.ofPerson(ACME, { party: 'attio', personShipId: MATHILDE_SHIP_ID })).resolves.toMatchObject({ accessToken: 'access-2' });
  });

  it('sets when a grant last served a call, in its fleet only', async () => {
    const grants = createPrismaPartyGrants(prisma);
    await Promise.all([grants.keep(aPartyGrant({ fleetId: ACME })), grants.keep(aPartyGrant({ fleetId: LABS }))]);

    await grants.markUsed({ fleetId: ACME, party: 'attio', personShipId: MATHILDE_SHIP_ID }, NOW);

    await expect(Promise.all([grants.ofPerson(ACME, { party: 'attio', personShipId: MATHILDE_SHIP_ID }), grants.ofPerson(LABS, { party: 'attio', personShipId: MATHILDE_SHIP_ID })])).resolves.toEqual([
      aPartyGrant({ fleetId: ACME, lastUsedAt: NOW }),
      aPartyGrant({ fleetId: LABS }),
    ]);
  });

  it("forgets a forgotten fleet's grants", async () => {
    await createPrismaPartyGrants(prisma).keep(aPartyGrant({ fleetId: ACME }));

    await createPrismaFleetForgetter(prisma).forget(ACME);

    await expect(prisma.partyGrant.count({ where: { fleetId: ACME } })).resolves.toBe(0);
  });
});

describe("the notices of a missing sign-in in the gateway's database (Q6)", () => {
  const joris = { party: 'attio', personShipId: JORIS_SHIP_ID };

  it('opens one notice per person and party, the first id kept when two calls open it at once', async () => {
    const notices = createPrismaSignInNotices(prisma);

    const opened = await Promise.all([notices.open(ACME, { ...joris, noticeId: 'notice-1' }), notices.open(ACME, { ...joris, noticeId: 'notice-2' })]);

    expect(new Set(opened.map(({ noticeId }) => noticeId)).size).toBe(1);
    await expect(prisma.partySignInNotice.count()).resolves.toBe(1);
  });

  it('keeps a notice told until a sign-in closes it, in its fleet only', async () => {
    const notices = createPrismaSignInNotices(prisma);
    await notices.open(ACME, { ...joris, noticeId: 'notice-1' });

    await notices.markTold(ACME, joris);

    await expect(Promise.all([notices.open(ACME, { ...joris, noticeId: 'notice-2' }), notices.open(LABS, { ...joris, noticeId: 'notice-3' })])).resolves.toEqual([
      { noticeId: 'notice-1', isTold: true },
      { noticeId: 'notice-3', isTold: false },
    ]);
  });

  it('opens a new notice after a sign-in closed the told one', async () => {
    const notices = createPrismaSignInNotices(prisma);
    await notices.open(ACME, { ...joris, noticeId: 'notice-1' });
    await notices.markTold(ACME, joris);

    await notices.close(ACME, joris);

    await expect(notices.open(ACME, { ...joris, noticeId: 'notice-2' })).resolves.toEqual({ noticeId: 'notice-2', isTold: false });
  });

  it("forgets a forgotten fleet's notices", async () => {
    await createPrismaSignInNotices(prisma).open(ACME, { ...joris, noticeId: 'notice-1' });

    await createPrismaFleetForgetter(prisma).forget(ACME);

    await expect(prisma.partySignInNotice.count({ where: { fleetId: ACME } })).resolves.toBe(0);
  });
});
