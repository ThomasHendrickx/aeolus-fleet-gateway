import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaItemOutcomes } from '../src/adapters/prisma/item-outcomes.js';
import { createPrismaSlackLinks } from '../src/adapters/prisma/slack-links.js';
import { createPrismaSlackPosts } from '../src/adapters/prisma/slack-posts.js';
import type { SlackPost } from '../src/core/slack/slack-post.js';
import { migratedDatabase } from './support/database.js';
import { aSlackLink } from './support/slack-fakes.js';

// The fleet messages in Slack (gateway scopes 9.5): a reply finds where its
// message is, an answer in a thread finds the delivery it answers, and a
// post the gateway did not finish is found again.

const ACME: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const MATHILDE_SHIP = 'shp_01m3tbfspe96yf1rnr4ank9m4t' as const;

function aPost(overrides: Partial<SlackPost> = {}): SlackPost {
  return { fleetId: ACME, personShipId: MATHILDE_SHIP, messageId: 'msg_01m3tbfspe96yf1rnr4ank0001', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9r1n', appId: 'A02', channel: 'D0MATHILDE', ts: '1730020000.000001', threadTs: null, ...overrides };
}

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

beforeEach(async () => {
  await prisma.slackPost.deleteMany();
  await prisma.itemOutcome.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the fleet messages in Slack, in the gateway's database", () => {
  it('keeps a post by its message, changed in place, and finds it by its message', async () => {
    const posts = createPrismaSlackPosts(prisma);
    await posts.save(aPost({ ts: null }));
    await posts.save(aPost());

    await expect(posts.ofMessage(ACME, { personShipId: MATHILDE_SHIP, messageId: 'msg_01m3tbfspe96yf1rnr4ank0001' })).resolves.toEqual(aPost());
  });

  it('finds the latest delivery in a thread, its first message included, for the person ship only', async () => {
    const posts = createPrismaSlackPosts(prisma);
    await posts.save(aPost());
    await posts.save(aPost({ messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', ts: '1730020000.000009', threadTs: '1730020000.000001' }));
    await posts.save(aPost({ personShipId: 'shp_01m3tbfspe96yf1rnr4ank9j0r', messageId: 'msg_01m3tbfspe96yf1rnr4ank0003', ts: '1730020000.000099', threadTs: '1730020000.000001' }));

    const last = await posts.lastInThread(ACME, { personShipId: MATHILDE_SHIP, appId: 'A02', channel: 'D0MATHILDE', threadTs: '1730020000.000001' });

    expect(last?.messageId).toBe('msg_01m3tbfspe96yf1rnr4ank0002');
  });

  it('finds the posts the gateway did not finish: deliveries not yet in Slack', async () => {
    const posts = createPrismaSlackPosts(prisma);
    await posts.save(aPost({ messageId: 'msg_01m3tbfspe96yf1rnr4ank0001', ts: null }));
    await posts.save(aPost({ messageId: 'msg_01m3tbfspe96yf1rnr4ank0002' }));
    await posts.save(aPost({ messageId: 'msg_01m3tbfspe96yf1rnr4ank0003', deliveryId: null, senderShipId: null, ts: null }));

    const unfinished = await posts.unfinished(ACME, MATHILDE_SHIP);

    expect(unfinished.map(({ messageId }) => messageId)).toEqual(['msg_01m3tbfspe96yf1rnr4ank0001']);
  });

  it('finds a link by its person ship', async () => {
    const links = createPrismaSlackLinks(prisma);
    await prisma.slackLink.deleteMany();
    await links.add(aSlackLink({ fleetId: ACME }));

    await expect(links.ofPersonShip(ACME, MATHILDE_SHIP)).resolves.toEqual(aSlackLink({ fleetId: ACME }));
  });

  it("forgets a forgotten fleet's posts", async () => {
    await createPrismaSlackPosts(prisma).save(aPost());

    await createPrismaFleetForgetter(prisma).forget(ACME);

    await expect(prisma.slackPost.count()).resolves.toBe(0);
  });
});

describe('the posts to edit once something came of their item (Bridge, view sync)', () => {
  const AT = new Date('2026-10-31T19:58:00.000Z');
  const outcomeOf = (deliveryId: `dlv_${string}`, at: Date) => ({ fleetId: ACME, shipId: MATHILDE_SHIP, deliveryId, place: 'bridge' as const, kind: 'answered' as const, option: 2, at });

  it('finds the posts in Slack whose item something came of, with what came of it, oldest outcome first', async () => {
    const posts = createPrismaSlackPosts(prisma);
    const outcomes = createPrismaItemOutcomes(prisma);
    const second = aPost({ messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', ts: '1730020000.000002' });
    await posts.save(aPost());
    await posts.save(second);
    await posts.save(aPost({ messageId: 'msg_01m3tbfspe96yf1rnr4ank0003', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0003', ts: '1730020000.000003' }));
    await outcomes.save(outcomeOf('dlv_01m3tbfspe96yf1rnr4ank0002', AT));
    await outcomes.save(outcomeOf('dlv_01m3tbfspe96yf1rnr4ank0001', new Date(AT.getTime() + 1000)));

    await expect(posts.toEdit({ limit: 10 })).resolves.toEqual([
      { post: second, outcome: { place: 'bridge', kind: 'answered', option: 2 } },
      { post: aPost(), outcome: { place: 'bridge', kind: 'answered', option: 2 } },
    ]);
  });

  it('leaves out a post edited, one not yet in Slack, and the person ship of another', async () => {
    const posts = createPrismaSlackPosts(prisma);
    const outcomes = createPrismaItemOutcomes(prisma);
    await posts.save(aPost());
    await posts.save(aPost({ messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', ts: null }));
    await posts.save(aPost({ personShipId: 'shp_01m3tbfspe96yf1rnr4ank9j0r', messageId: 'msg_01m3tbfspe96yf1rnr4ank0003', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0003' }));
    await outcomes.save(outcomeOf('dlv_01m3tbfspe96yf1rnr4ank0001', AT));
    await outcomes.save(outcomeOf('dlv_01m3tbfspe96yf1rnr4ank0002', AT));
    await outcomes.save(outcomeOf('dlv_01m3tbfspe96yf1rnr4ank0003', AT));

    await posts.markEdited(ACME, { personShipId: MATHILDE_SHIP, messageId: 'msg_01m3tbfspe96yf1rnr4ank0001' });

    await expect(posts.toEdit({ limit: 10 })).resolves.toEqual([]);
  });

  it('finds no more than the limit', async () => {
    const posts = createPrismaSlackPosts(prisma);
    const outcomes = createPrismaItemOutcomes(prisma);
    await posts.save(aPost());
    await posts.save(aPost({ messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002' }));
    await outcomes.save(outcomeOf('dlv_01m3tbfspe96yf1rnr4ank0001', AT));
    await outcomes.save(outcomeOf('dlv_01m3tbfspe96yf1rnr4ank0002', AT));

    await expect(posts.toEdit({ limit: 1 })).resolves.toHaveLength(1);
  });
});
