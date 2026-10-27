import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { aPersonDelivery, fakePersonShipDoor } from '../../../test/support/people-fakes.js';
import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aSlackApp, aSlackLink, fakeSlackMessages, memorySlackApps, memorySlackLinks, memorySlackPosts } from '../../../test/support/slack-fakes.js';
import type { PersonDelivery } from '../people/ports.js';
import { createShowInSlack } from './show-in-slack.js';

// Each delivery to a linked person's person ship shows in Slack (gateway
// scopes 9.5): a reply to a message from Slack in that conversation or
// thread; a bot ship's message in that bot's direct messages (P-B1);
// anything else through the gateway's own bot, headed by the sender, once
// the person turned Slack on (B5). It is handed with channel slack, posted,
// its Slack message kept, then acknowledged (B4); a link for what Slack does
// not show in full is handed only. Every delivery shown once, handed once.

const MATHILDE_SHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9m4t';
const RELEASE_NOTES: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9r1n';
const BUDGET_CHECK: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9bdg';
const SHIP = { fleetId: FLEET_ID, shipId: MATHILDE_SHIP };
const CREW = 'crew-mathilde';

const FROM_RELEASE_NOTES = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0001', messageId: 'msg_01m3tbfspe96yf1rnr4ank0001', senderShipId: RELEASE_NOTES, senderName: 'release-notes', contentType: 'text/plain', payload: 'Friday', questionTitle: null });
const FROM_BUDGET_CHECK = aPersonDelivery({ deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', senderShipId: BUDGET_CHECK, senderName: 'budget-check', contentType: 'text/plain', payload: 'Over budget', questionTitle: null });

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

async function show(fleet: ReturnType<typeof aShip>) {
  const taken = await fleet.door.pushReceive(CREW, { max: 100 });
  const fresh = taken.isOk ? taken.value.filter(({ handOverNumber }) => handOverNumber === null) : [];
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
    overviewUrlOf: (fleetId) => `https://gateway.acme.test/overview?fleet=${fleetId}`,
  })(SHIP, { crewToken: CREW, fresh });
}

describe('a delivery to a linked person, in Slack', () => {
  it("shows a bot ship's message in that bot's direct messages, handed with channel slack, posted, then acknowledged", async () => {
    const fleet = aShip([FROM_RELEASE_NOTES]);

    const shown = await show(fleet);

    expect(shown.isOk && [...shown.value]).toEqual([FROM_RELEASE_NOTES.deliveryId]);
    expect(fleet.handOvers).toEqual([{ deliveryId: FROM_RELEASE_NOTES.deliveryId, handOverNumber: 1, channel: 'slack' }]);
    expect(slack.state.posts.map(({ botToken, channel, threadTs, text }) => ({ botToken, channel, threadTs, text }))).toEqual([{ botToken: 'xoxb-2', channel: 'U0MATHILDE', threadTs: null, text: 'Friday' }]);
    expect(fleet.calls.filter((call) => !call.startsWith('pushReceive'))).toEqual([`handed(${FROM_RELEASE_NOTES.deliveryId})`, `ack(${FROM_RELEASE_NOTES.deliveryId})`]);
    expect(posts.held).toEqual([expect.objectContaining({ deliveryId: FROM_RELEASE_NOTES.deliveryId, appId: 'A02', channel: 'U0MATHILDE', ts: '1730020000.000001', ackedAt: new Date('2026-10-27T09:00:00.000Z') })]);
  });

  it('shows every delivery once, handed once, however often the person is woken', async () => {
    const fleet = aShip([FROM_RELEASE_NOTES]);

    await show(fleet);
    await show(fleet);

    expect({ posts: slack.state.posts.length, handOvers: fleet.handOvers.length }).toEqual({ posts: 1, handOvers: 1 });
  });

  it('shows a reply to a message from Slack in that conversation, in its thread', async () => {
    await posts.save({ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, messageId: 'msg_01m3tbfspe96yf1rnr4ank0own', deliveryId: null, senderShipId: null, appId: 'A02', channel: 'C0LAUNCH', ts: '1730019600.000100', threadTs: null, isLinkOnly: false, ackedAt: null });
    const fleet = aShip([{ ...FROM_RELEASE_NOTES, inReplyTo: 'msg_01m3tbfspe96yf1rnr4ank0own' }]);

    await show(fleet);

    expect(slack.state.posts.map(({ channel, threadTs }) => ({ channel, threadTs }))).toEqual([{ channel: 'C0LAUNCH', threadTs: '1730019600.000100' }]);
  });

  it("shows a message from a ship that is not a bot through the gateway's own bot, headed by the sender, once the person turned Slack on", async () => {
    await links.showAll(FLEET_ID, { accountId: 'acc-mathilde', isOn: true });
    const fleet = aShip([FROM_BUDGET_CHECK]);

    await show(fleet);

    expect(slack.state.posts.map(({ botToken, channel, text }) => ({ botToken, channel, text }))).toEqual([{ botToken: 'xoxb-1', channel: 'U0MATHILDE', text: '*budget-check*\nOver budget' }]);
  });

  it('leaves a message from a ship that is not a bot to web push and email while Slack is off', async () => {
    const fleet = aShip([FROM_BUDGET_CHECK]);

    const shown = await show(fleet);

    expect({ shown: shown.isOk && [...shown.value], handOvers: fleet.handOvers, posts: slack.state.posts }).toEqual({ shown: [], handOvers: [], posts: [] });
  });

  it('shows a question with one button per option', async () => {
    const fleet = aShip([{ ...FROM_RELEASE_NOTES, contentType: 'application/vnd.aeolus.question+json', payload: JSON.stringify({ id: '5f0c6c1e-8a39-4f37-9b0c-1c6d0e4f2a11', title: 'Ship it?', context: 'Ready', options: [{ key: 1, label: 'Ship', detail: '' }], pick: { option: 1, why: 'ready' } }) }]);

    await show(fleet);

    expect(slack.state.posts.map(({ text, buttons }) => ({ text, buttons }))).toEqual([{ text: '*Ship it?*\nReady', buttons: [{ text: 'Ship', option: 1 }] }]);
  });

  it('posts a link for what Slack does not show in full, handed only, never acknowledged', async () => {
    const fleet = aShip([{ ...FROM_RELEASE_NOTES, contentType: 'image/png', payload: 'abc' }]);

    const shown = await show(fleet);

    expect(shown.isOk && shown.value.size).toBe(1);
    expect(fleet.handOvers.map(({ channel }) => channel)).toEqual(['slack']);
    expect(fleet.calls.some((call) => call.startsWith('ack('))).toBe(false);
    expect(slack.state.posts[0]?.text).toContain('open it in the gateway');
  });

  it("falls back to the gateway's own bot when the bot was removed in Slack, with Slack on", async () => {
    await apps.save(aSlackApp({ appId: 'A02', shipId: RELEASE_NOTES, name: 'release-notes', bot: null, removedInSlackAt: new Date('2026-10-27T08:00:00.000Z') }));
    await links.showAll(FLEET_ID, { accountId: 'acc-mathilde', isOn: true });
    const fleet = aShip([FROM_RELEASE_NOTES]);

    await show(fleet);

    expect(slack.state.posts.map(({ botToken, text }) => ({ botToken, text }))).toEqual([{ botToken: 'xoxb-1', text: '*release-notes*\nFriday' }]);
  });

  it('falls back to web push and email when the bot was removed in Slack, with Slack off', async () => {
    await apps.save(aSlackApp({ appId: 'A02', shipId: RELEASE_NOTES, name: 'release-notes', bot: null, removedInSlackAt: new Date('2026-10-27T08:00:00.000Z') }));
    const fleet = aShip([FROM_RELEASE_NOTES]);

    const shown = await show(fleet);

    expect({ shown: shown.isOk && shown.value.size, handOvers: fleet.handOvers.length }).toEqual({ shown: 0, handOvers: 0 });
  });

  it("falls back to web push and email when Slack refuses the post, as for a deactivated Slack user", async () => {
    slack.state.postRefusals.push({ kind: 'refused', error: 'user_not_found' });
    const fleet = aShip([FROM_RELEASE_NOTES]);

    const shown = await show(fleet);

    expect({ shown: shown.isOk && shown.value.size, acked: fleet.calls.some((call) => call.startsWith('ack(')), posts: posts.held }).toEqual({ shown: 0, acked: false, posts: [] });
  });

  it("waits Slack's Retry-After when rate limited, then posts once with the same hand-over", async () => {
    slack.state.postRefusals.push({ kind: 'rateLimited', retryAfterSeconds: 3 });
    const fleet = aShip([FROM_RELEASE_NOTES]);

    await show(fleet);

    expect({ slept, posts: slack.state.posts.length, handOvers: fleet.handOvers.length }).toEqual({ slept: [3000], posts: 1, handOvers: 1 });
  });

  it('acknowledges again a post whose acknowledgement core refused, never posting it twice', async () => {
    const fleet = aShip([FROM_RELEASE_NOTES]);
    const ack = fleet.door.ack.bind(fleet.door);
    let isRefusing = true;
    fleet.door.ack = (crewToken, deliveryId) => (isRefusing ? Promise.resolve({ isOk: false as const, error: { code: 'UNAVAILABLE', message: 'down' } }) : ack(crewToken, deliveryId));

    await show(fleet);
    isRefusing = false;
    await show(fleet);

    expect({ posts: slack.state.posts.length, acked: posts.held[0]?.ackedAt !== null }).toEqual({ posts: 1, acked: true });
  });

  it('posts again a delivery handed but never posted, as when the gateway stopped in between: at most one duplicate', async () => {
    const fleet = aShip([FROM_RELEASE_NOTES]);
    await posts.save({ fleetId: FLEET_ID, personShipId: MATHILDE_SHIP, messageId: FROM_RELEASE_NOTES.messageId, deliveryId: FROM_RELEASE_NOTES.deliveryId, senderShipId: RELEASE_NOTES, appId: 'A02', channel: 'U0MATHILDE', ts: null, threadTs: null, isLinkOnly: false, ackedAt: null });
    await fleet.door.handed(CREW, { deliveryId: FROM_RELEASE_NOTES.deliveryId, handOverNumber: 1, channel: 'slack' });

    await show(fleet);

    expect({ posts: slack.state.posts.length, acked: fleet.calls.includes(`ack(${FROM_RELEASE_NOTES.deliveryId})`) }).toEqual({ posts: 1, acked: true });
  });

  it('shows nothing to a person who did not link Slack, or whose link stopped', async () => {
    await links.stop(FLEET_ID, { accountId: 'acc-mathilde', at: new Date('2026-10-27T08:50:00.000Z') });
    const fleet = aShip([FROM_RELEASE_NOTES]);

    const shown = await show(fleet);

    expect({ shown: shown.isOk && shown.value.size, handOvers: fleet.handOvers.length }).toEqual({ shown: 0, handOvers: 0 });
  });
});
