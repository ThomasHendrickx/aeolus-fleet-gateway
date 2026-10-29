import type { FleetId } from '@aeolus-fleet/common';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
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
const AT = new Date('2026-10-27T09:00:00.000Z');

function aPost(overrides: Partial<SlackPost> = {}): SlackPost {
  return { fleetId: ACME, personShipId: MATHILDE_SHIP, messageId: 'msg_01m3tbfspe96yf1rnr4ank0001', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9r1n', appId: 'A02', channel: 'D0MATHILDE', ts: '1730020000.000001', threadTs: null, isLinkOnly: false, ackedAt: AT, ...overrides };
}

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
});

beforeEach(async () => {
  await prisma.slackPost.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the fleet messages in Slack, in the gateway's database", () => {
  it('keeps a post by its message, changed in place, and finds it by its message and by its Slack message', async () => {
    const posts = createPrismaSlackPosts(prisma);
    await posts.save(aPost({ ts: null, ackedAt: null }));
    await posts.save(aPost());

    await expect(Promise.all([
      posts.ofMessage(ACME, { personShipId: MATHILDE_SHIP, messageId: 'msg_01m3tbfspe96yf1rnr4ank0001' }),
      posts.atSlackMessage(ACME, { personShipId: MATHILDE_SHIP, appId: 'A02', channel: 'D0MATHILDE', ts: '1730020000.000001' }),
    ])).resolves.toEqual([aPost(), aPost()]);
  });

  it('finds the latest delivery in a thread, its first message included, for the person ship only', async () => {
    const posts = createPrismaSlackPosts(prisma);
    await posts.save(aPost());
    await posts.save(aPost({ messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', ts: '1730020000.000009', threadTs: '1730020000.000001' }));
    await posts.save(aPost({ personShipId: 'shp_01m3tbfspe96yf1rnr4ank9j0r', messageId: 'msg_01m3tbfspe96yf1rnr4ank0003', ts: '1730020000.000099', threadTs: '1730020000.000001' }));

    const last = await posts.lastInThread(ACME, { personShipId: MATHILDE_SHIP, appId: 'A02', channel: 'D0MATHILDE', threadTs: '1730020000.000001' });

    expect(last?.messageId).toBe('msg_01m3tbfspe96yf1rnr4ank0002');
  });

  it('finds the posts the gateway did not finish: not in Slack, or not acknowledged, links aside', async () => {
    const posts = createPrismaSlackPosts(prisma);
    await posts.save(aPost({ messageId: 'msg_01m3tbfspe96yf1rnr4ank0001', ts: null, ackedAt: null }));
    await posts.save(aPost({ messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', ackedAt: null }));
    await posts.save(aPost({ messageId: 'msg_01m3tbfspe96yf1rnr4ank0003', isLinkOnly: true, ackedAt: null }));
    await posts.save(aPost({ messageId: 'msg_01m3tbfspe96yf1rnr4ank0004' }));
    await posts.save(aPost({ messageId: 'msg_01m3tbfspe96yf1rnr4ank0005', deliveryId: null, senderShipId: null, ackedAt: null }));

    const unfinished = await posts.unfinished(ACME, MATHILDE_SHIP);

    expect(unfinished.map(({ messageId }) => messageId).sort()).toEqual(['msg_01m3tbfspe96yf1rnr4ank0001', 'msg_01m3tbfspe96yf1rnr4ank0002']);
  });

  it("finds a link by its person ship and turns Show everything that waits in Slack on", async () => {
    const links = createPrismaSlackLinks(prisma);
    await prisma.slackLink.deleteMany();
    await links.add(aSlackLink({ fleetId: ACME }));

    await links.showAll(ACME, { accountId: 'acc-mathilde', isOn: true });

    await expect(links.ofPersonShip(ACME, MATHILDE_SHIP)).resolves.toEqual(aSlackLink({ fleetId: ACME, isShowingAll: true }));
  });

  it("forgets a forgotten fleet's posts", async () => {
    await createPrismaSlackPosts(prisma).save(aPost());

    await createPrismaFleetForgetter(prisma).forget(ACME);

    await expect(prisma.slackPost.count()).resolves.toBe(0);
  });
});
