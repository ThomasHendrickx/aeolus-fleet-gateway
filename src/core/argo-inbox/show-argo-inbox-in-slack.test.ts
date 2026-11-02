import { QUESTION_CONTENT_TYPE, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { anArgoEntry, fakeArgoInboxFleet, memoryArgoAccounts, memoryArgoSlackPosts, TRIERARCH } from '../../../test/support/argo-inbox-fakes.js';
import { FLEET_ID, memoryConnectionStore, SHIP_ID } from '../../../test/support/fleet-fakes.js';
import { memoryRoutes } from '../../../test/support/people-fakes.js';
import { aSlackApp, aSlackLink, fakeShipNames, fakeSlackMessages, memorySlackApps, memorySlackLinks } from '../../../test/support/slack-fakes.js';
import { routingDefaultsOf, type Route } from '../people/routing.js';
import { createFollowArgoInbox } from './follow-argo-inbox.js';
import { createShowArgoInboxInSlack } from './show-argo-inbox-in-slack.js';

// For each person allowed as argo who turned Slack on, each message open at
// argo is posted once, through the gateway's own bot, marked Waits at argo,
// not you, with one button to the console as argo and no answer buttons
// (argo's inbox, AI2 to AI4). Once done at argo, by anyone, anywhere, the
// post is edited to say who did it and when, its button gone.

const MATHILDE_SHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9m4t';
const THOMAS_SHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9t0m';
const TURNED_ON_AT = new Date('2026-10-19T00:00:00.000Z');
const DONE_AT = new Date('2026-11-01T20:14:00.000Z');
const signal = new AbortController().signal;

/** Slack turned on for the job by the person, before anything in these tests was sent. */
function slackOnFor(shipId: ShipId, job: Route['job']): Route {
  return { fleetId: FLEET_ID, shipId, job, place: 'slack', isOn: true, changedAt: TURNED_ON_AT };
}

let fleet: ReturnType<typeof fakeArgoInboxFleet>;
let connections: ReturnType<typeof memoryConnectionStore>;
let accounts: ReturnType<typeof memoryArgoAccounts>;
let posts: ReturnType<typeof memoryArgoSlackPosts>;
let apps: ReturnType<typeof memorySlackApps>;
let links: ReturnType<typeof memorySlackLinks>;
let routes: ReturnType<typeof memoryRoutes>;
let slack: ReturnType<typeof fakeSlackMessages>;

beforeEach(async () => {
  fleet = fakeArgoInboxFleet();
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: TURNED_ON_AT });
  accounts = memoryArgoAccounts();
  await accounts.keep(FLEET_ID, { accountId: 'acc-mathilde', personShipId: MATHILDE_SHIP });
  await accounts.keep(FLEET_ID, { accountId: 'acc-thomas', personShipId: THOMAS_SHIP });
  posts = memoryArgoSlackPosts();
  apps = memorySlackApps();
  await apps.save(aSlackApp({ appId: 'A01', name: 'Aeolus fleet', bot: { token: 'xoxb-1', userId: 'U01' } }));
  links = memorySlackLinks();
  await links.add(aSlackLink());
  await links.add(aSlackLink({ slackUserId: 'U0THOMAS', slackName: 'thomas', accountId: 'acc-thomas', personShipId: THOMAS_SHIP }));
  routes = memoryRoutes([slackOnFor(MATHILDE_SHIP, 'everything-else'), slackOnFor(MATHILDE_SHIP, 'decide'), slackOnFor(THOMAS_SHIP, 'everything-else')]);
  slack = fakeSlackMessages();
});

/** The gateway as it runs, from its start: following argo's inbox, then showing it in Slack, round after round. */
function aGateway() {
  const follow = createFollowArgoInbox({ connections, door: fleet.door });
  const show = createShowArgoInboxInSlack({
    connections,
    inboxOf: follow.inboxOf,
    doneAtArgo: follow.doneAtArgo,
    door: fleet.door,
    accounts,
    posts,
    links,
    apps,
    slack: slack.messages,
    routes,
    defaults: routingDefaultsOf([]),
    shipNames: fakeShipNames({ [THOMAS_SHIP]: 'thomas', [MATHILDE_SHIP]: 'mathilde' }),
    argoMessageUrlOf: (deliveryId) => `https://fleet.acme.test/inbox?message=${deliveryId}`,
  });
  return {
    round: async () => {
      await follow.round(signal);
      await show();
    },
  };
}

/** Who got which message posted, in order. */
function postedTo() {
  return slack.state.posts.map(({ channel, messageId }) => ({ channel, messageId }));
}

describe("what waits at argo, in Slack's post", () => {
  it('posts each message open at argo once to each person allowed as argo who turned Slack on, through the gateway bot', async () => {
    fleet.send(anArgoEntry(1));
    const gateway = aGateway();

    await gateway.round();
    await gateway.round();

    expect(slack.state.posts.map(({ botToken, channel, messageId }) => ({ botToken, channel, messageId }))).toEqual([
      { botToken: 'xoxb-1', channel: 'U0MATHILDE', messageId: anArgoEntry(1).messageId },
      { botToken: 'xoxb-1', channel: 'U0THOMAS', messageId: anArgoEntry(1).messageId },
    ]);
  });

  it('marks the post Waits at argo, not you, with its kind, sender and headline, for everyone allowed as argo, with one button to the console as argo', async () => {
    fleet.send(anArgoEntry(1, { payload: 'thomas-mac is low on disk: 4% free', sender: { ...TRIERARCH, name: 'thomas-mac' } }));

    await aGateway().round();

    expect(slack.state.posts[0]).toMatchObject({
      text: 'Waits at argo, not you: thomas-mac is low on disk: 4% free',
      item: {
        asker: 'thomas-mac',
        heading: '*Waits at argo*, not you · Report from trierarch thomas-mac',
        title: 'thomas-mac is low on disk: 4% free',
        body: null,
        aside: 'For everyone allowed as argo. Acting signs you in to the console as argo.',
        footer: null,
        tone: 'argo',
      },
      buttons: [{ text: 'Open in the console as argo', url: `https://fleet.acme.test/inbox?message=${anArgoEntry(1).deliveryId}`, isPlain: true }],
    });
  });

  it('gives a question no answer buttons: acting stays with argo, in the console', async () => {
    fleet.send(anArgoEntry(1, { contentType: QUESTION_CONTENT_TYPE, headline: 'Which repository?', sender: { ...TRIERARCH, name: 'thomas-mac' } }));

    await aGateway().round();

    expect(slack.state.posts.map(({ item, buttons }) => ({ heading: item?.heading, buttons }))).toEqual([
      { heading: '*Waits at argo*, not you · Question from trierarch thomas-mac', buttons: [{ text: 'Open in the console as argo', url: `https://fleet.acme.test/inbox?message=${anArgoEntry(1).deliveryId}`, isPlain: true }] },
    ]);
  });

  it("reads each sender's type once, not once a post", async () => {
    fleet.send(anArgoEntry(1));
    const gateway = aGateway();
    await gateway.round();

    fleet.send(anArgoEntry(2));
    await gateway.round();

    expect({ posts: slack.state.posts.length, typeReads: fleet.state.typeReads }).toEqual({ posts: 4, typeReads: [anArgoEntry(1).sender.shipId] });
  });

  it('edits the post once done at argo to say by whom and when, in the console, its button gone', async () => {
    fleet.send(anArgoEntry(1));
    const gateway = aGateway();
    await gateway.round();

    fleet.markDone(anArgoEntry(1).messageId, { at: DONE_AT, signedInAccountId: 'acc-thomas' });
    await gateway.round();

    expect(slack.state.edits.map(({ channel, message }) => ({ channel, body: message.item?.body, tone: message.item?.tone, aside: message.item?.aside, buttons: message.buttons }))).toEqual(
      ['U0MATHILDE', 'U0THOMAS'].map((channel) => ({ channel, body: '✅ Done at argo by thomas in the console, <!date^1793564040^{time}|20:14 UTC>', tone: 'done', aside: null, buttons: [] })),
    );
  });

  it('says only that it was done at argo for a message done while the gateway was down, as it saw no one do it', async () => {
    fleet.send(anArgoEntry(1));
    await aGateway().round();
    fleet.markDone(anArgoEntry(1).messageId, { at: DONE_AT, signedInAccountId: 'acc-thomas' });

    await aGateway().round();

    expect(slack.state.edits.map(({ message }) => message.item?.body)).toEqual(['✅ Done at argo in the console', '✅ Done at argo in the console']);
  });

  it('edits each post once, and forgets it then', async () => {
    fleet.send(anArgoEntry(1));
    const gateway = aGateway();
    await gateway.round();
    fleet.markDone(anArgoEntry(1).messageId);

    await gateway.round();
    await gateway.round();

    expect({ edits: slack.state.edits.length, kept: posts.held }).toEqual({ edits: 2, kept: [] });
  });

  it('posts at most once more after a restart that came between keeping a post and Slack taking it', async () => {
    fleet.send(anArgoEntry(1));
    fleet.send(anArgoEntry(2));
    await posts.keep({ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, messageId: anArgoEntry(1).messageId, appId: 'A01', channel: 'U0MATHILDE', ts: null, isGivenUp: false });
    await posts.keep({ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, messageId: anArgoEntry(2).messageId, appId: 'A01', channel: 'U0MATHILDE', ts: '1730019999.000001', isGivenUp: false });
    routes.held.splice(0, routes.held.length, slackOnFor(MATHILDE_SHIP, 'everything-else'));

    const restarted = aGateway();
    await restarted.round();
    await restarted.round();

    expect(postedTo()).toEqual([{ channel: 'U0MATHILDE', messageId: anArgoEntry(1).messageId }]);
  });

  it("drops Slack out once the gateway's bot was removed in Slack: nothing is posted there", async () => {
    await apps.save(aSlackApp({ appId: 'A01', name: 'Aeolus fleet', bot: { token: 'xoxb-1', userId: 'U01' }, removedInSlackAt: TURNED_ON_AT }));
    fleet.send(anArgoEntry(1));

    await aGateway().round();

    expect(postedTo()).toEqual([]);
  });

  it('gives up a post Slack refuses, and never posts it again', async () => {
    routes.held.splice(0, routes.held.length, slackOnFor(MATHILDE_SHIP, 'everything-else'));
    slack.state.postRefusals.push({ kind: 'refused', error: 'channel_not_found' });
    fleet.send(anArgoEntry(1));
    const gateway = aGateway();

    await gateway.round();
    await gateway.round();

    expect({ posted: postedTo(), kept: posts.held.map(({ isGivenUp }) => isGivenUp) }).toEqual({ posted: [], kept: [true] });
  });

  it('posts it at the next round when Slack rate limited it', async () => {
    routes.held.splice(0, routes.held.length, slackOnFor(MATHILDE_SHIP, 'everything-else'));
    slack.state.postRefusals.push({ kind: 'rateLimited', retryAfterSeconds: 1 });
    fleet.send(anArgoEntry(1));
    const gateway = aGateway();

    await gateway.round();
    await gateway.round();

    expect(postedTo()).toEqual([{ channel: 'U0MATHILDE', messageId: anArgoEntry(1).messageId }]);
  });

  it('posts nothing for an account no longer allowed as argo', async () => {
    await accounts.drop(FLEET_ID, 'acc-thomas');
    fleet.send(anArgoEntry(1));

    await aGateway().round();

    expect(postedTo()).toEqual([{ channel: 'U0MATHILDE', messageId: anArgoEntry(1).messageId }]);
  });

  it("posts nothing to a person who did not turn Slack on for the message's job, or turned it on only after it was sent", async () => {
    routes.held.splice(0, routes.held.length, slackOnFor(MATHILDE_SHIP, 'decide'), { ...slackOnFor(THOMAS_SHIP, 'everything-else'), changedAt: new Date('2026-11-01T10:00:00.000Z') });
    fleet.send(anArgoEntry(1));

    await aGateway().round();

    expect(postedTo()).toEqual([]);
  });

  it('posts nothing to a person whose Slack link stopped', async () => {
    await links.stop(FLEET_ID, { accountId: 'acc-thomas', at: TURNED_ON_AT });
    fleet.send(anArgoEntry(1));

    await aGateway().round();

    expect(postedTo()).toEqual([{ channel: 'U0MATHILDE', messageId: anArgoEntry(1).messageId }]);
  });

  it('posts nothing while argo has not let the gateway read its inbox', async () => {
    fleet.state.isReadRuleOn = false;
    fleet.send(anArgoEntry(1));

    await aGateway().round();

    expect(postedTo()).toEqual([]);
  });
});
