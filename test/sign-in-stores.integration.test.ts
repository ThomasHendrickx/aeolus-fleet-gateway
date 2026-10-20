import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaAccountGrants } from '../src/adapters/prisma/account-grants.js';
import type { AccountGrant } from '../src/core/sign-in/ports.js';
import { migratedDatabase } from './support/database.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const PERSON_SHIP: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8pp';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

function aGrant(overrides: Partial<AccountGrant> = {}): AccountGrant {
  return {
    grantId: 'grant-1',
    fleetId: FLEET,
    accountId: 'acc-charlotte',
    personShipId: PERSON_SHIP,
    refreshToken: 'pagasae-refresh-1',
    accountToken: 'account-token-1',
    accountTokenExpiresAt: new Date('2026-10-19T09:10:00.000Z'),
    ...overrides,
  };
}

describe("signed-in accounts' grants in Postgres (decision 0054)", () => {
  it('keeps a grant with its fleet, account, person ship and pagasae tokens', async () => {
    await createPrismaAccountGrants(prisma).save(aGrant());

    await expect(prisma.accountGrant.findMany({ where: { grantId: 'grant-1' } })).resolves.toMatchObject([aGrant()]);
  });

  it('keeps a grant of an account with no person ship', async () => {
    await createPrismaAccountGrants(prisma).save(aGrant({ grantId: 'grant-2', personShipId: null }));

    await expect(prisma.accountGrant.findMany({ where: { grantId: 'grant-2' } })).resolves.toMatchObject([{ personShipId: null }]);
  });

  it('finds a grant in its fleet only, renews its tokens, and ends it', async () => {
    const grants = createPrismaAccountGrants(prisma);
    await grants.save(aGrant({ grantId: 'grant-3' }));
    await expect(grants.find(OTHER_FLEET, 'grant-3')).resolves.toBeUndefined();

    await grants.renew(FLEET, 'grant-3', { refreshToken: 'pagasae-refresh-2', accountToken: 'account-token-2', accountTokenExpiresAt: new Date('2026-10-19T09:19:00.000Z'), personShipId: null });
    await expect(grants.find(FLEET, 'grant-3')).resolves.toEqual(aGrant({ grantId: 'grant-3', refreshToken: 'pagasae-refresh-2', accountToken: 'account-token-2', accountTokenExpiresAt: new Date('2026-10-19T09:19:00.000Z'), personShipId: null }));

    await grants.end(FLEET, 'grant-3');
    await expect(grants.find(FLEET, 'grant-3')).resolves.toBeUndefined();
  });

  it('forgets a fleet with its grants (decision 0021)', async () => {
    await createPrismaAccountGrants(prisma).save(aGrant({ grantId: 'grant-o', fleetId: OTHER_FLEET }));

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    await expect(prisma.accountGrant.count({ where: { fleetId: OTHER_FLEET } })).resolves.toBe(0);
  });
});
