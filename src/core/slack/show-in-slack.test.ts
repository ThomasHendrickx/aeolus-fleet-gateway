import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { aPersonDelivery, fakePersonShipDoor } from '../../../test/support/people-fakes.js';
import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aSlackApp, aSlackLink, fakeSlackMessages, memorySlackApps, memorySlackLinks, memorySlackPosts } from '../../../test/support/slack-fakes.js';
import type { PersonDelivery, PushedPersonDelivery } from '../people/ports.js';
import { routingDefaultsOf, routingOf, type Route } from '../people/routing.js';
import { createShowInSlack } from './show-in-slack.js';

// Each delivery to a linked person's person ship shows in Slack (gateway
// scopes 9.5): a reply to a message from Slack in that conversation or
// thread; a bot ship's message in that bot's direct messages (P-B1);
// anything else through the gateway's own bot, headed by the sender. Each
// job shows there once the person turned Slack on for it (Bridge, section 8),
// only what arrives after; with Slack off for everything else, a bot ship's
// messages and replies into Slack still show (9.5 as before). It is handed
// with channel slack, posted and its Slack message kept, never acknowledged:
// only the person's action does that (CC6). Every delivery shown once,
// handed once.

const MATHILDE_SHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9m4t';
const RELEASE_NOTES: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9r1n';
const BUDGET_CHECK: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9bdg';
const SHIP = { fleetId: FLEET_ID, shipId: MATHILDE_SHIP };
const CREW = 'crew-mathilde';
const TURNED_ON_AT = new Date('2026-10-19T00:00:00.000Z');

/** Slack turned on for the job, before anything in these tests was sent. */
function slackOnFor(job: Route['job'], changedAt = TURNED_ON_AT): Route {
  return { ...SHIP, job, place: 'slack', isOn: true, changedAt };
}

const FROM_RELEASE_NOTES_FIELDS = { deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', messageId: 'msg_01m3tbfspe96yf1rnr4ank0001', senderShipId: RELEASE_NOTES, senderName: 'release-notes' } as const;
const FROM_RELEASE_NOTES = aPersonDelivery({ ...FROM_RELEASE_NOTES_FIELDS, contentType: 'text/plain', payload: 'Friday', headline: null });
const A_QUESTION = aPersonDelivery({ ...FROM_RELEASE_NOTES_FIELDS, contentType: 'application/vnd.aeolus.question+json', payload: JSON.stringify({ id: '5f0c6c1e-8a39-4f37-9b0c-1c6d0e4f2a11', title: 'Ship it?', context: 'Ready', options: [{ key: 1, label: 'Ship', detail: '' }], pick: { option: 1, why: 'ready' } }) });
const FROM_BUDGET_CHECK = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', senderShipId: BUDGET_CHECK, senderName: 'budget-check', contentType: 'text/plain', payload: 'Over budget', headline: null });

let apps: ReturnType<typeof memorySlackApps>;
let links: ReturnType<typeof memorySlackLinks>;
let posts: ReturnType<typeof memorySlackPosts>;
let slack: ReturnType<typeof fakeSlackMessages>;
let slept: number[];

beforeEach(async () => {
  apps = memorySlackApps();
  links = memorySlackLinks();
  posts = memorySlackPosts();
  slack = fakeSlackMessages();
  slept = [];
  await apps.save(aSlackApp({ appId: 'A01', name: 'Acme', bot: { token: 'xoxb-1', userId: 'U01' } }));
  await apps.save(aSlackApp({ appId: 'A02', shipId: RELEASE_NOTES, name: 'release-notes', bot: { token: 'xoxb-2', userId: 'U02' } }));
  await links.add(aSlackLink());
});

function aShip(deliveries: PersonDelivery[]) {
  return fakePersonShipDoor({ crewToken: CREW, deliveries });
}

/** Shows what is fresh: by default each delivery never handed, as the wake hands them. */
async function show(fleet: ReturnType<typeof aShip>, given: { fresh?: readonly PushedPersonDelivery[]; routes?: readonly Route[] } = {}) {
  const { fresh: freshGiven, routes = [] } = given;
  const taken = await fleet.door.pushReceive(CREW, { max: 100 });
  const fresh = freshGiven ?? (taken.isOk ? taken.value.filter(({ handOverNumber }) => handOverNumber === null) : []);
  return createShowInSlack({
    links,
    apps,
    posts,
    slack: slack.messages,
    door: fleet.door,
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
    clock: { now: () => new Date('2026-10-27T09:00:00.000Z') },
    bridgeUrlOf: (fleetId) => `https://gateway.acme.test/bridge?fleet=${fleetId}`,
  })(SHIP, { crewToken: CREW, fresh, routing: routingOf(routes, routingDefaultsOf([])) });
}

describe('a delivery to a linked person, in Slack', () => {
  it("shows a bot ship's message in that bot's direct messages, handed with channel slack and posted, never acknowledged: only the person's action does that (CC6)", async () => {
    const fleet = aShip([FROM_RELEASE_NOTES]);

    const shown = await show(fleet);

    expect(shown.isOk && [...shown.value.shown]).toEqual([FROM_RELEASE_NOTES.deliveryId]);
    expect(fleet.handOvers).toEqual([{ deliveryId: FROM_RELEASE_NOTES.deliveryId, handOverNumber: 1, channel: 'slack' }]);
    expect(slack.state.posts.map(({ botToken, channel, threadTs, text }) => ({ botToken, channel, threadTs, text }))).toEqual([{ botToken: 'xoxb-2', channel: 'U0MATHILDE', threadTs: null, text: 'Friday' }]);
    expect(fleet.calls.filter((call) => !call.startsWith('pushReceive'))).toEqual([`handed(${FROM_RELEASE_NOTES.deliveryId})`]);
    expect(posts.held).toEqual([expect.objectContaining({ deliveryId: FROM_RELEASE_NOTES.deliveryId, appId: 'A02', channel: 'U0MATHILDE', ts: '1730020000.000001' })]);
  });

  it('shows every delivery once, handed once, however often the person is woken', async () => {
    const fleet = aShip([FROM_RELEASE_NOTES]);

    await show(fleet);
    await show(fleet);

    expect({ posts: slack.state.posts.length, handOvers: fleet.handOvers.length }).toEqual({ posts: 1, handOvers: 1 });
  });

  it('shows a reply to a message from Slack in that conversation, in its thread', async () => {
    await posts.save({ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, messageId: 'msg_01m3tbfspe96yf1rnr4ank0own', deliveryId: null, senderShipId: null, appId: 'A02', channel: 'C0LAUNCH', ts: '1730019600.000100', threadTs: null });
    const fleet = aShip([{ ...FROM_RELEASE_NOTES, inReplyTo: 'msg_01m3tbfspe96yf1rnr4ank0own' }]);

    await show(fleet);

    expect(slack.state.posts.map(({ channel, threadTs }) => ({ channel, threadTs }))).toEqual([{ channel: 'C0LAUNCH', threadTs: '1730019600.000100' }]);
  });

  it("shows a message from a ship that is not a bot through the gateway's own bot, headed by the sender, once the person turned Slack on for its job", async () => {
    const fleet = aShip([FROM_BUDGET_CHECK]);

    await show(fleet, { routes: [slackOnFor('everything-else')] });

    expect(slack.state.posts.map(({ botToken, channel, text }) => ({ botToken, channel, text }))).toEqual([{ botToken: 'xoxb-1', channel: 'U0MATHILDE', text: '*budget-check*\nOver budget' }]);
  });

  it('leaves a message from a ship that is not a bot to Bridge and the wakes while Slack is off for its job', async () => {
    const fleet = aShip([FROM_BUDGET_CHECK]);

    const shown = await show(fleet);

    expect({ shown: shown.isOk && [...shown.value.shown], handOvers: fleet.handOvers, posts: slack.state.posts }).toEqual({ shown: [], handOvers: [], posts: [] });
  });

  it('shows a question with one button per option, once Slack is on for decide', async () => {
    const fleet = aShip([A_QUESTION]);

    await show(fleet, { routes: [slackOnFor('decide')] });

    expect(slack.state.posts.map(({ text, buttons }) => ({ text, buttons }))).toEqual([{ text: '*Ship it?*\nReady', buttons: [{ text: 'Ship', option: 1 }] }]);
  });

  it('posts a link for what Slack does not show in full, handed', async () => {
    const fleet = aShip([{ ...FROM_RELEASE_NOTES, contentType: 'image/png', payload: 'abc' }]);

    const shown = await show(fleet);

    expect(shown.isOk && shown.value.shown.size).toBe(1);
    expect(fleet.handOvers.map(({ channel }) => channel)).toEqual(['slack']);
    expect(fleet.calls.some((call) => call.startsWith('ack('))).toBe(false);
    expect(slack.state.posts[0]?.text).toContain('open it in the gateway');
  });

  it("falls back to the gateway's own bot when the bot was removed in Slack, with Slack on for its job", async () => {
    await apps.save(aSlackApp({ appId: 'A02', shipId: RELEASE_NOTES, name: 'release-notes', bot: null, removedInSlackAt: new Date('2026-10-27T08:00:00.000Z') }));
    const fleet = aShip([FROM_RELEASE_NOTES]);

    await show(fleet, { routes: [slackOnFor('everything-else')] });

    expect(slack.state.posts.map(({ botToken, text }) => ({ botToken, text }))).toEqual([{ botToken: 'xoxb-1', text: '*release-notes*\nFriday' }]);
  });

  it('falls back to Bridge and the wakes when the bot was removed in Slack, with Slack off for its job', async () => {
    await apps.save(aSlackApp({ appId: 'A02', shipId: RELEASE_NOTES, name: 'release-notes', bot: null, removedInSlackAt: new Date('2026-10-27T08:00:00.000Z') }));
    const fleet = aShip([FROM_RELEASE_NOTES]);

    const shown = await show(fleet);

    expect({ shown: shown.isOk && shown.value.shown.size, handOvers: fleet.handOvers.length }).toEqual({ shown: 0, handOvers: 0 });
  });

  it("falls back to web push and email when Slack refuses the post, as for a deactivated Slack user", async () => {
    slack.state.postRefusals.push({ kind: 'refused', error: 'user_not_found' });
    const fleet = aShip([FROM_RELEASE_NOTES]);

    const shown = await show(fleet);

    expect({ shown: shown.isOk && shown.value.shown.size, acked: fleet.calls.some((call) => call.startsWith('ack(')), posts: posts.held }).toEqual({ shown: 0, acked: false, posts: [] });
  });

  it("waits Slack's Retry-After when rate limited, then posts once with the same hand-over", async () => {
    slack.state.postRefusals.push({ kind: 'rateLimited', retryAfterSeconds: 3 });
    const fleet = aShip([FROM_RELEASE_NOTES]);

    await show(fleet);

    expect({ slept, posts: slack.state.posts.length, handOvers: fleet.handOvers.length }).toEqual({ slept: [3000], posts: 1, handOvers: 1 });
  });

  it('posts again a delivery handed but never posted, as when the gateway stopped in between: at most one duplicate', async () => {
    const fleet = aShip([FROM_RELEASE_NOTES]);
    await posts.save({ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, messageId: FROM_RELEASE_NOTES.messageId, deliveryId: FROM_RELEASE_NOTES.deliveryId, senderShipId: RELEASE_NOTES, appId: 'A02', channel: 'U0MATHILDE', ts: null, threadTs: null });
    await fleet.door.handed(CREW, { deliveryId: FROM_RELEASE_NOTES.deliveryId, handOverNumber: 1, channel: 'slack' });

    await show(fleet);

    expect({ posts: slack.state.posts.length, ts: posts.held[0]?.ts, acked: fleet.calls.includes(`ack(${FROM_RELEASE_NOTES.deliveryId})`) }).toEqual({ posts: 1, ts: '1730020000.000001', acked: false });
  });

  it('says nothing is left unfinished once every post is in Slack', async () => {
    const fleet = aShip([FROM_RELEASE_NOTES]);

    const shown = await show(fleet);

    expect(shown.isOk && shown.value.isAnyUnfinished).toBe(false);
  });

  it('keeps a post not yet in Slack whose delivery the read did not hold while it still waits, posting it once the read holds it', async () => {
    const others = Array.from({ length: 3 }, (_, index) => aPersonDelivery({ deliveryId: `dlv_01m3tbfspe96yf1rnr4ank010${String(index)}`, messageId: `msg_01m3tbfspe96yf1rnr4ank010${String(index)}`, senderShipId: BUDGET_CHECK }));
    const fleet = aShip([...others, FROM_RELEASE_NOTES]);
    for (const other of others) {
      await fleet.door.handed(CREW, { deliveryId: other.deliveryId, handOverNumber: 1, channel: 'email' });
    }
    await posts.save({ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, messageId: FROM_RELEASE_NOTES.messageId, deliveryId: FROM_RELEASE_NOTES.deliveryId, senderShipId: RELEASE_NOTES, appId: 'A02', channel: 'U0MATHILDE', ts: null, threadTs: null });
    await fleet.door.handed(CREW, { deliveryId: FROM_RELEASE_NOTES.deliveryId, handOverNumber: 1, channel: 'slack' });

    const first = await show(fleet, { fresh: [] });
    const keptPosts = posts.held.length;
    for (const other of others) {
      await fleet.door.ack(CREW, other.deliveryId);
    }
    await show(fleet, { fresh: [] });

    expect({ isAnyUnfinished: first.isOk && first.value.isAnyUnfinished, keptPosts, posted: slack.state.posts.length, ts: posts.held[0]?.ts }).toEqual({ isAnyUnfinished: true, keptPosts: 1, posted: 1, ts: '1730020000.000001' });
  });

  it('forgets a post not yet in Slack whose delivery was acknowledged meanwhile, posting nothing', async () => {
    const fleet = aShip([FROM_RELEASE_NOTES]);
    await posts.save({ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, messageId: FROM_RELEASE_NOTES.messageId, deliveryId: FROM_RELEASE_NOTES.deliveryId, senderShipId: RELEASE_NOTES, appId: 'A02', channel: 'U0MATHILDE', ts: null, threadTs: null });
    await fleet.door.handed(CREW, { deliveryId: FROM_RELEASE_NOTES.deliveryId, handOverNumber: 1, channel: 'slack' });
    await fleet.door.ack(CREW, FROM_RELEASE_NOTES.deliveryId);

    const shown = await show(fleet, { fresh: [] });

    expect({ posts: posts.held, posted: slack.state.posts.length, isAnyUnfinished: shown.isOk && shown.value.isAnyUnfinished }).toEqual({ posts: [], posted: 0, isAnyUnfinished: false });
  });

  it("leaves a bot ship's question to Bridge while Slack is off for decide: the job decides, whoever asks", async () => {
    const fleet = aShip([A_QUESTION]);

    const shown = await show(fleet);

    expect({ shown: shown.isOk && shown.value.shown.size, handOvers: fleet.handOvers, posts: slack.state.posts }).toEqual({ shown: 0, handOvers: [], posts: [] });
  });

  it('shows a reply into a Slack thread with Slack off for everything else, as before routing', async () => {
    await posts.save({ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, messageId: 'msg_01m3tbfspe96yf1rnr4ank0own', deliveryId: null, senderShipId: null, appId: 'A01', channel: 'C0LAUNCH', ts: '1730019600.000100', threadTs: null });
    const fleet = aShip([{ ...FROM_BUDGET_CHECK, inReplyTo: 'msg_01m3tbfspe96yf1rnr4ank0own' }]);

    await show(fleet);

    expect(slack.state.posts.map(({ botToken, channel }) => ({ botToken, channel }))).toEqual([{ botToken: 'xoxb-1', channel: 'C0LAUNCH' }]);
  });

  it('shows only what arrived since Slack was turned on for the job, never what was already there (CC20)', async () => {
    const before = { ...A_QUESTION, deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0009', messageId: 'msg_01m3tbfspe96yf1rnr4ank0009', sentAt: new Date('2026-10-19T07:59:59.999Z') } as const;
    const fleet = aShip([before, A_QUESTION]);

    await show(fleet, { routes: [slackOnFor('decide', A_QUESTION.sentAt)] });

    expect(fleet.handOvers.map(({ deliveryId }) => deliveryId)).toEqual([A_QUESTION.deliveryId]);
  });

  it('shows nothing to a person who did not link Slack, or whose link stopped', async () => {
    await links.stop(FLEET_ID, { accountId: 'acc-mathilde', at: new Date('2026-10-27T08:50:00.000Z') });
    const fleet = aShip([FROM_RELEASE_NOTES]);

    const shown = await show(fleet);

    expect({ shown: shown.isOk && shown.value.shown.size, handOvers: fleet.handOvers.length }).toEqual({ shown: 0, handOvers: 0 });
  });
});
