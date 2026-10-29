import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { aKeptSlackEvent, aSlackApp, aSlackLink, fakeSlackMessages, memorySlackApps, memorySlackEvents, memorySlackLinks, memorySlackPosts } from '../../../test/support/slack-fakes.js';
import type { SlackEventFields } from './slack-event.js';
import { createTakeSlackEvent } from './take-slack-event.js';

// Slack signs each event with the app's signing secret (gateway scopes 9.4
// step 1): the gateway takes only an event signed so, within 5 minutes of
// its timestamp. An app uninstalled or its tokens revoked shows Removed in
// Slack (9.2).

const NOW = new Date('2026-10-27T09:00:00.000Z');
const NOW_SECONDS = String(NOW.getTime() / 1000);
const RELEASE_NOTES = 'shp_01m3tbfspe96yf1rnr4ank9r1n';
const LINK_PAGE_URL = 'https://gateway.acme.test/slack/link';

let apps: ReturnType<typeof memorySlackApps>;
let links: ReturnType<typeof memorySlackLinks>;
let slack: ReturnType<typeof fakeSlackMessages>;
let events: ReturnType<typeof memorySlackEvents>;
let posts: ReturnType<typeof memorySlackPosts>;
let sendsNow: number;

beforeEach(async () => {
  events = memorySlackEvents();
  posts = memorySlackPosts();
  sendsNow = 0;
  apps = memorySlackApps();
  links = memorySlackLinks();
  slack = fakeSlackMessages();
  await apps.save(aSlackApp({ appId: 'A02', shipId: RELEASE_NOTES, name: 'release-notes', bot: { token: 'xoxb-2', userId: 'U02' } }));
});

/** Signs as a test: the signature is the secret, the timestamp and the body joined. */
const signatures = { isSigned: ({ secret, timestamp, body, signature }: { secret: string; timestamp: string; body: string; signature: string }) => signature === `${secret}:${timestamp}:${body}` };

function takeEvent(event: { type: string; timestamp?: string; signature?: string; appId?: string; fields?: Partial<SlackEventFields>; isRetry?: boolean }) {
  const timestamp = event.timestamp ?? NOW_SECONDS;
  const fields: SlackEventFields = { eventId: 'Ev01', type: event.type, teamId: 'T0ACME', userId: null, channel: null, channelType: null, subtype: null, botId: null, text: '', ts: '1730019600.000100', threadTs: null, files: [], ...event.fields };
  const body = JSON.stringify({ api_app_id: event.appId ?? 'A02', event: fields });
  return createTakeSlackEvent({ apps, links, events, posts, sendNow: () => { sendsNow += 1; }, slack: slack.messages, signatures, clock: { now: () => NOW }, linkPageUrl: LINK_PAGE_URL })({
    appId: event.appId ?? 'A02',
    event: fields,
    isRetry: event.isRetry ?? false,
    body,
    timestamp,
    signature: event.signature ?? `signing-${event.appId ?? 'A02'}:${timestamp}:${body}`,
  });
}

describe('an event Slack sends the gateway', () => {
  it("marks the app Removed in Slack when it is uninstalled, forgetting its bot token", async () => {
    await expect(takeEvent({ type: 'app_uninstalled' })).resolves.toEqual({ isOk: true, value: { kind: 'taken' } });
    expect(apps.held[0]).toMatchObject({ removedInSlackAt: NOW, bot: null });
  });

  it('marks it Removed in Slack when its tokens are revoked', async () => {
    await takeEvent({ type: 'tokens_revoked' });

    expect(apps.held[0]?.removedInSlackAt).toEqual(NOW);
  });

  it('refuses an event not signed with the app\'s signing secret, changing nothing', async () => {
    await expect(takeEvent({ type: 'app_uninstalled', signature: 'v0=forged' })).resolves.toEqual({ isOk: false, error: { kind: 'notSigned' } });
    expect(apps.held[0]?.removedInSlackAt).toBeNull();
  });

  it('refuses an event whose timestamp is more than 5 minutes off, at the boundary taken', async () => {
    const fiveMinutesAgo = String(NOW.getTime() / 1000 - 300);
    const moreThanFive = String(NOW.getTime() / 1000 - 301);

    await expect(takeEvent({ type: 'tokens_revoked', timestamp: moreThanFive })).resolves.toEqual({ isOk: false, error: { kind: 'notSigned' } });
    await expect(takeEvent({ type: 'tokens_revoked', timestamp: fiveMinutesAgo })).resolves.toMatchObject({ isOk: true });
  });

  it('refuses an event for an app the gateway did not make', async () => {
    await expect(takeEvent({ type: 'app_uninstalled', appId: 'A99' })).resolves.toEqual({ isOk: false, error: { kind: 'notSigned' } });
  });

  it('takes an event it does not act on yet, changing nothing', async () => {
    await expect(takeEvent({ type: 'app_mention' })).resolves.toEqual({ isOk: true, value: { kind: 'ignored' } });
    expect(apps.held[0]?.removedInSlackAt).toBeNull();
  });
});

// An unlinked person who messages or mentions a bot gets an answer only they
// see, with a button to link (gateway scopes 9.3). Their message is not
// stored, since it has no sender yet. A disabled account's link stopped.

const MATHILDE_WRITES = { userId: 'U0MATHILDE', channel: 'D0MATHILDE', channelType: 'im' };

describe("a person's message to a bot, from Slack", () => {
  it('answers an unlinked person only they see, with a button to link, and never stores the message', async () => {
    const taken = await takeEvent({ type: 'message', fields: MATHILDE_WRITES });

    expect(taken).toEqual({ isOk: true, value: { kind: 'notLinked' } });
    expect(events.held).toEqual([]);
    expect(slack.state.onlyTo).toEqual([{
      botToken: 'xoxb-2',
      channel: 'D0MATHILDE',
      user: 'U0MATHILDE',
      text: 'Link your Slack account to talk to release-notes. Your message was not kept: send it again once linked.',
      button: { text: 'Link Slack', url: `${LINK_PAGE_URL}?fleet=${FLEET_ID}` },
    }]);
  });

  it('answers an unlinked person who mentions the bot in a channel, in that channel', async () => {
    await takeEvent({ type: 'app_mention', fields: { userId: 'U0JORIS', channel: 'C0LAUNCH' } });

    expect(slack.state.onlyTo.map(({ channel, user }) => ({ channel, user }))).toEqual([{ channel: 'C0LAUNCH', user: 'U0JORIS' }]);
  });

  it('answers a person whose account was disabled that it cannot message the fleet now', async () => {
    await links.add(aSlackLink({ stoppedAt: new Date('2026-10-27T08:50:00.000Z') }));

    await takeEvent({ type: 'message', fields: MATHILDE_WRITES });

    expect(slack.state.onlyTo.map(({ text, button }) => ({ text, button }))).toEqual([{ text: 'Your account cannot message the fleet now', button: undefined }]);
  });

  it("keeps a linked person's message by its event id, as Markdown for the bot's ship and the person ship, and sends it now", async () => {
    await links.add(aSlackLink());

    const taken = await takeEvent({ type: 'message', fields: { ...MATHILDE_WRITES, text: '<@U02> when is the release?' } });

    expect(taken).toEqual({ isOk: true, value: { kind: 'kept' } });
    expect(events.held).toEqual([aKeptSlackEvent({ receivedAt: NOW })]);
    expect({ sendsNow, onlyTo: slack.state.onlyTo }).toEqual({ sendsNow: 1, onlyTo: [] });
  });

  it('keeps a message with a shared file, the file as its Slack link', async () => {
    await links.add(aSlackLink());

    await takeEvent({ type: 'message', fields: { ...MATHILDE_WRITES, subtype: 'file_share', text: 'here', files: [{ name: 'notes.pdf', permalink: 'https://acme.slack.com/files/U0M/F01/notes.pdf' }] } });

    expect(events.held.map(({ markdown }) => markdown)).toEqual(['here\n\n[notes.pdf](https://acme.slack.com/files/U0M/F01/notes.pdf)']);
  });

  it('keeps an answer in the thread under a posted delivery in reply to its message, to its sender, to hand it then', async () => {
    await links.add(aSlackLink());
    await apps.save(aSlackApp({ appId: 'A01', name: 'Acme', bot: { token: 'xoxb-1', userId: 'U01' } }));
    await posts.save({ fleetId: FLEET_ID, personShipId: 'shp_01m3tbfspe96yf1rnr4ank9m4t', messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9bdg', appId: 'A01', channel: 'D0MATHILDE', ts: '1730020000.000001', threadTs: null, isLinkOnly: false, ackedAt: NOW });

    await takeEvent({ type: 'message', appId: 'A01', fields: { ...MATHILDE_WRITES, text: 'Cut the travel', threadTs: '1730020000.000001' } });

    expect(events.held.map(({ shipId, inReplyTo, deliveryId, markdown }) => ({ shipId, inReplyTo, deliveryId, markdown }))).toEqual([{ shipId: 'shp_01m3tbfspe96yf1rnr4ank9bdg', inReplyTo: 'msg_01m3tbfspe96yf1rnr4ank0002', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', markdown: 'Cut the travel' }]);
  });

  it("keeps an answer in a thread through the gateway's own bot while a delivery in that conversation waits for Slack, to match it once sent", async () => {
    await links.add(aSlackLink());
    await apps.save(aSlackApp({ appId: 'A01', name: 'Acme', bot: { token: 'xoxb-1', userId: 'U01' } }));
    await posts.save({ fleetId: FLEET_ID, personShipId: 'shp_01m3tbfspe96yf1rnr4ank9m4t', messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', deliveryId: 'dlv_01m3tbfspe96yf1rnr4ank0002', senderShipId: 'shp_01m3tbfspe96yf1rnr4ank9bdg', appId: 'A01', channel: 'D0MATHILDE', ts: null, threadTs: null, isLinkOnly: false, ackedAt: null });

    const taken = await takeEvent({ type: 'message', appId: 'A01', fields: { ...MATHILDE_WRITES, text: 'Cut the travel', threadTs: '1730020000.000001' } });

    expect({ taken, kept: events.held.map(({ shipId, inReplyTo, deliveryId, threadTs }) => ({ shipId, inReplyTo, deliveryId, threadTs })) }).toEqual({
      taken: { isOk: true, value: { kind: 'kept' } },
      kept: [{ shipId: null, inReplyTo: null, deliveryId: null, threadTs: '1730020000.000001' }],
    });
  });

  it("keeps nothing of a message to the gateway's own bot that answers no posted delivery", async () => {
    await links.add(aSlackLink());
    await apps.save(aSlackApp({ appId: 'A01', name: 'Acme', bot: { token: 'xoxb-1', userId: 'U01' } }));

    const taken = await takeEvent({ type: 'message', appId: 'A01', fields: { ...MATHILDE_WRITES, text: 'hello' } });

    expect({ taken, kept: events.held }).toEqual({ taken: { isOk: true, value: { kind: 'ignored' } }, kept: [] });
  });

  it("keeps Slack's retry of a kept event no second time", async () => {
    await links.add(aSlackLink());
    await takeEvent({ type: 'message', fields: { ...MATHILDE_WRITES, text: 'when is the release?' } });

    const retried = await takeEvent({ type: 'message', fields: { ...MATHILDE_WRITES, text: 'when is the release?' }, isRetry: true });

    expect(retried).toEqual({ isOk: true, value: { kind: 'known' } });
    expect({ kept: events.held.length, sendsNow }).toEqual({ kept: 1, sendsNow: 1 });
  });

  it("answers a Slack retry of the event no second time", async () => {
    await takeEvent({ type: 'message', fields: MATHILDE_WRITES, isRetry: true });

    expect(slack.state.onlyTo).toEqual([]);
  });

  it("answers no bot's message, edit or message in a channel that is not a mention", async () => {
    await takeEvent({ type: 'message', fields: { ...MATHILDE_WRITES, botId: 'B0OTHER' } });
    await takeEvent({ type: 'message', fields: { ...MATHILDE_WRITES, subtype: 'message_changed' } });
    await takeEvent({ type: 'message', fields: { ...MATHILDE_WRITES, subtype: 'channel_join' } });
    await takeEvent({ type: 'message', fields: { ...MATHILDE_WRITES, channelType: 'channel' } });

    expect(slack.state.onlyTo).toEqual([]);
  });
});
