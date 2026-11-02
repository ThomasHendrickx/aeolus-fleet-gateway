import type { FleetId, MessageId, ShipId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPrismaArgoAccounts } from '../src/adapters/prisma/argo-accounts.js';
import { createPrismaArgoSlackPosts } from '../src/adapters/prisma/argo-slack-posts.js';
import type { ArgoSlackPost } from '../src/core/argo-inbox/argo-slack-post.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { migratedDatabase } from './support/database.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const CHARLOTTE_SHIP: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8pp';
const CHARLOTTE_NEW_SHIP: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8pq';
const MATHILDE_SHIP: ShipId = 'shp_01m3tb1zgr5h2ffee12xnch8pr';
const LOW_ON_DISK: MessageId = 'msg_01m3tb1zgr5h2ffee12xnch8d1';
const OUT_OF_CREDIT: MessageId = 'msg_01m3tb1zgr5h2ffee12xnch8d2';

/** Mathilde's post of a message to argo, not yet in Slack, unless the test says otherwise. */
function anArgoSlackPost(overrides: Partial<ArgoSlackPost> = {}): ArgoSlackPost {
  return { fleetId: FLEET, personShipId: MATHILDE_SHIP, messageId: LOW_ON_DISK, appId: 'A01', channel: 'U0MATHILDE', ts: null, isGivenUp: false, ...overrides };
}

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

describe("what waits at argo, in Slack, in Postgres (argo's inbox, AI4)", () => {
  it('keeps a post once per person ship and message, a second keep finding it known', async () => {
    const posts = createPrismaArgoSlackPosts(prisma);

    const kept = [await posts.keep(anArgoSlackPost()), await posts.keep(anArgoSlackPost({ channel: 'U0OTHER' })), await posts.keep(anArgoSlackPost({ personShipId: CHARLOTTE_SHIP, channel: 'U0CHARLOTTE' }))];

    expect({ kept, held: await posts.list(FLEET) }).toEqual({ kept: ['kept', 'known', 'kept'], held: [anArgoSlackPost({ personShipId: CHARLOTTE_SHIP, channel: 'U0CHARLOTTE' }), anArgoSlackPost()] });
  });

  it('keeps a post given its Slack message, or given up, in its fleet only', async () => {
    const posts = createPrismaArgoSlackPosts(prisma);
    await posts.keep(anArgoSlackPost({ fleetId: OTHER_FLEET }));
    await posts.keep(anArgoSlackPost({ messageId: OUT_OF_CREDIT }));

    await posts.save(anArgoSlackPost({ ts: '1730020000.000001' }));
    await posts.save(anArgoSlackPost({ messageId: OUT_OF_CREDIT, isGivenUp: true }));

    await expect(Promise.all([posts.list(FLEET), posts.list(OTHER_FLEET)])).resolves.toEqual([
      [anArgoSlackPost({ personShipId: CHARLOTTE_SHIP, channel: 'U0CHARLOTTE' }), anArgoSlackPost({ ts: '1730020000.000001' }), anArgoSlackPost({ messageId: OUT_OF_CREDIT, isGivenUp: true })],
      [anArgoSlackPost({ fleetId: OTHER_FLEET })],
    ]);
  });

  it('forgets a post, and every post with its fleet', async () => {
    const posts = createPrismaArgoSlackPosts(prisma);

    await posts.remove(FLEET, { personShipId: CHARLOTTE_SHIP, messageId: LOW_ON_DISK });
    const removed = await posts.list(FLEET);
    await createPrismaFleetForgetter(prisma).forget(FLEET);

    expect({ removed: removed.map(({ personShipId, messageId }) => ({ personShipId, messageId })), forgotten: await posts.list(FLEET), other: (await posts.list(OTHER_FLEET)).length }).toEqual({
      removed: [{ personShipId: MATHILDE_SHIP, messageId: LOW_ON_DISK }, { personShipId: MATHILDE_SHIP, messageId: OUT_OF_CREDIT }],
      forgotten: [],
      other: 1,
    });
  });
});
