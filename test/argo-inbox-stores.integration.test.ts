import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaArgoAccounts } from '../src/adapters/prisma/argo-accounts.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { migratedDatabase } from './support/database.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const CHARLOTTE_SHIP: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8pp';
const CHARLOTTE_NEW_SHIP: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8pq';
const MATHILDE_SHIP: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8pr';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the accounts allowed as argo in Postgres (argo's inbox, AI9)", () => {
  it('keeps each account once per fleet, with the person ship its latest token named', async () => {
    const accounts = createPrismaArgoAccounts(prisma);
    await accounts.keep(FLEET, { accountId: 'acc-charlotte', personShipId: CHARLOTTE_SHIP });
    await accounts.keep(FLEET, { accountId: 'acc-charlotte', personShipId: CHARLOTTE_NEW_SHIP });
    await accounts.keep(FLEET, { accountId: 'acc-mathilde', personShipId: MATHILDE_SHIP });
    await accounts.keep(OTHER_FLEET, { accountId: 'acc-mathilde', personShipId: MATHILDE_SHIP });

    await expect(accounts.list(FLEET)).resolves.toEqual([
      { accountId: 'acc-charlotte', personShipId: CHARLOTTE_NEW_SHIP },
      { accountId: 'acc-mathilde', personShipId: MATHILDE_SHIP },
    ]);
  });

  it('drops an account in its fleet only', async () => {
    const accounts = createPrismaArgoAccounts(prisma);
    await accounts.keep(FLEET, { accountId: 'acc-mathilde', personShipId: MATHILDE_SHIP });
    await accounts.keep(OTHER_FLEET, { accountId: 'acc-mathilde', personShipId: MATHILDE_SHIP });

    await accounts.drop(FLEET, 'acc-mathilde');
    await accounts.drop(FLEET, 'acc-nobody');

    await expect(Promise.all([accounts.list(FLEET), accounts.list(OTHER_FLEET)])).resolves.toEqual([
      [{ accountId: 'acc-charlotte', personShipId: CHARLOTTE_NEW_SHIP }],
      [{ accountId: 'acc-mathilde', personShipId: MATHILDE_SHIP }],
    ]);
  });

  it('are forgotten with their fleet', async () => {
    const accounts = createPrismaArgoAccounts(prisma);

    await createPrismaFleetForgetter(prisma).forget(FLEET);

    await expect(Promise.all([accounts.list(FLEET), accounts.list(OTHER_FLEET)])).resolves.toEqual([[], [{ accountId: 'acc-mathilde', personShipId: MATHILDE_SHIP }]]);
  });
});
