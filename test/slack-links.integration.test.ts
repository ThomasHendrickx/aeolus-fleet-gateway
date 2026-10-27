import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaSlackLinks } from '../src/adapters/prisma/slack-links.js';
import { migratedDatabase } from './support/database.js';
import { aSlackLink } from './support/slack-fakes.js';

// Each fleet keeps its people's Slack links (gateway scopes 9.3): one Slack
// user to one account, one Slack user per account. Two links at once of the
// same Slack user keep one.

const ACME: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const LABS: FleetId = 'flt_01m4ajt7abh4rypkmdnjene67g';
const AT = new Date('2026-10-27T09:00:00.000Z');

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Slack links in the gateway's database", () => {
  it('keeps a link, found by its Slack user and by its account, in its fleet only', async () => {
    const links = createPrismaSlackLinks(prisma);

    await expect(links.add(aSlackLink({ fleetId: ACME }))).resolves.toBe('added');

    await expect(Promise.all([links.find(ACME, { teamId: 'T0ACME', userId: 'U0MATHILDE' }), links.ofAccount(ACME, 'acc-mathilde'), links.find(LABS, { teamId: 'T0ACME', userId: 'U0MATHILDE' })])).resolves.toEqual([aSlackLink({ fleetId: ACME }), aSlackLink({ fleetId: ACME }), undefined]);
  });

  it('refuses a second link of the Slack user in the fleet, two at once keeping one', async () => {
    const links = createPrismaSlackLinks(prisma);
    await prisma.slackLink.deleteMany({ where: { fleetId: ACME } });

    const added = await Promise.all([links.add(aSlackLink({ fleetId: ACME, accountId: 'acc-one' })), links.add(aSlackLink({ fleetId: ACME, accountId: 'acc-two' }))]);

    expect(added.sort()).toEqual(['added', 'taken']);
    await expect(prisma.slackLink.count({ where: { fleetId: ACME } })).resolves.toBe(1);
  });

  it('refuses a second link of the account in the fleet', async () => {
    const links = createPrismaSlackLinks(prisma);
    await prisma.slackLink.deleteMany({ where: { fleetId: ACME } });
    await links.add(aSlackLink({ fleetId: ACME }));

    await expect(links.add(aSlackLink({ fleetId: ACME, slackUserId: 'U0OTHER' }))).resolves.toBe('taken');
  });

  it('links the same Slack user in another fleet', async () => {
    const links = createPrismaSlackLinks(prisma);

    await expect(links.add(aSlackLink({ fleetId: LABS }))).resolves.toBe('added');
  });

  it('stops a link once, kept from when it first stopped, and removes it', async () => {
    const links = createPrismaSlackLinks(prisma);
    await prisma.slackLink.deleteMany({ where: { fleetId: ACME } });
    await links.add(aSlackLink({ fleetId: ACME }));

    await links.stop(ACME, { accountId: 'acc-mathilde', at: AT });
    await links.stop(ACME, { accountId: 'acc-mathilde', at: new Date('2026-10-27T10:00:00.000Z') });
    const stopped = await links.ofAccount(ACME, 'acc-mathilde');
    await links.remove(ACME, 'acc-mathilde');

    expect(stopped?.stoppedAt).toEqual(AT);
    await expect(links.ofAccount(ACME, 'acc-mathilde')).resolves.toBeUndefined();
  });

  it("forgets a forgotten fleet's links", async () => {
    await createPrismaSlackLinks(prisma).add(aSlackLink({ fleetId: ACME, accountId: 'acc-forgotten', slackUserId: 'U0FORGOTTEN' }));

    await createPrismaFleetForgetter(prisma).forget(ACME);

    await expect(prisma.slackLink.count({ where: { fleetId: ACME } })).resolves.toBe(0);
  });
});
