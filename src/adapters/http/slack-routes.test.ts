import { createHmac } from 'node:crypto';

import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { aSlackApp, aSlackLink, fakeSlackMessages, memorySlackApps, memorySlackEvents, memorySlackLinks, memorySlackPosts } from '../../../test/support/slack-fakes.js';
import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { err, ok } from '../../core/shared/result.js';
import { createTakeSlackEvent } from '../../core/slack/take-slack-event.js';
import { createSlackSignatures } from '../crypto/slack-signatures.js';
import { registerSlackRoutes, SLACK_ACTIONS_PATH, SLACK_EVENTS_PATH, SLACK_LINK_PATH } from './slack-routes.js';
import type { AnswerInSlack } from '../../core/slack/answer-in-slack.js';
import type { CompleteLink } from '../../core/slack/complete-link.js';

// Slack's events door (gateway scopes 9.2, 9.4 step 1): Slack checks the
// address with a challenge as it makes an app, before the gateway knows
// the app's signing secret; every other event is taken only signed.

const NOW = new Date('2026-10-27T09:00:00.000Z');

/** Signs a body as Slack does, with the app's signing secret: v0= and the hex HMAC-SHA256 of v0, the timestamp and the body. */
function signed(body: string, secret: string) {
  const timestamp = String(NOW.getTime() / 1000);
  return { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`, 'content-type': 'application/json' };
}

async function aServer(completeLink: CompleteLink = () => Promise.resolve(err({ kind: 'LINK_REFUSED' as const, message: 'unused' }))) {
  const apps = memorySlackApps();
  await apps.save(aSlackApp({ appId: 'A02', shipId: 'shp_01m3tbfspe96yf1rnr4ank9r1n', name: 'release-notes', bot: { token: 'xoxb-2', userId: 'U02' } }));
  const slack = fakeSlackMessages();
  const links = memorySlackLinks();
  const events = memorySlackEvents();
  const posts = memorySlackPosts();
  const pressed: Parameters<AnswerInSlack>[0][] = [];
  const server = Fastify();
  registerSlackRoutes(server, {
    completeInstall: () => Promise.resolve(err({ kind: 'INSTALL_REFUSED' as const, message: 'unused' })),
    completeLink,
    answerInSlack: (press) => {
      pressed.push(press);
      return Promise.resolve(ok({ kind: 'answered' as const }));
    },
    takeSlackEvent: createTakeSlackEvent({ apps, links, events, posts, sendNow: () => undefined, slack: slack.messages, signatures: createSlackSignatures(), clock: { now: () => NOW }, linkPageUrl: 'https://gateway.acme.test/slack/link' }),
  });
  return { server, apps, slack, links, events, pressed };
}

describe("Slack's events door", () => {
  it("answers Slack's address check with its challenge", async () => {
    const { server } = await aServer();

    const answer = await server.inject({ method: 'POST', url: SLACK_EVENTS_PATH, headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ type: 'url_verification', token: 't', challenge: 'the-challenge' }) });

    const answered: unknown = answer.json();
    expect({ status: answer.statusCode, body: answered }).toEqual({ status: 200, body: { challenge: 'the-challenge' } });
  });

  it("takes an app_uninstalled signed with the app's signing secret: the bot shows Removed in Slack", async () => {
    const { server, apps } = await aServer();
    const body = JSON.stringify({ type: 'event_callback', api_app_id: 'A02', team_id: 'T0ACME', event_id: 'Ev01', event: { type: 'app_uninstalled' } });

    const answer = await server.inject({ method: 'POST', url: SLACK_EVENTS_PATH, headers: signed(body, 'signing-A02'), payload: body });

    expect({ status: answer.statusCode, removedInSlackAt: apps.held[0]?.removedInSlackAt }).toEqual({ status: 200, removedInSlackAt: NOW });
  });

  it('refuses an event not signed with the app\'s signing secret, 401, changing nothing', async () => {
    const { server, apps } = await aServer();
    const body = JSON.stringify({ type: 'event_callback', api_app_id: 'A02', team_id: 'T0ACME', event_id: 'Ev00', event: { type: 'app_uninstalled' } });

    const answer = await server.inject({ method: 'POST', url: SLACK_EVENTS_PATH, headers: signed(body, 'another-secret'), payload: body });

    expect({ status: answer.statusCode, removedInSlackAt: apps.held[0]?.removedInSlackAt }).toEqual({ status: 401, removedInSlackAt: null });
  });

  it("reads a person's direct message to the bot, and answers Slack's retry of it no second time", async () => {
    const { server, slack } = await aServer();
    const body = JSON.stringify({ type: 'event_callback', api_app_id: 'A02', team_id: 'T0ACME', event_id: 'Ev02', event: { type: 'message', channel_type: 'im', channel: 'D0MATHILDE', user: 'U0MATHILDE', text: 'When is the release?', ts: '1730019600.000100' } });

    const first = await server.inject({ method: 'POST', url: SLACK_EVENTS_PATH, headers: signed(body, 'signing-A02'), payload: body });
    const retry = await server.inject({ method: 'POST', url: SLACK_EVENTS_PATH, headers: { ...signed(body, 'signing-A02'), 'x-slack-retry-num': '1', 'x-slack-retry-reason': 'http_timeout' }, payload: body });

    expect([first.statusCode, retry.statusCode]).toEqual([200, 200]);
    expect(slack.state.onlyTo.map(({ channel, user }) => ({ channel, user }))).toEqual([{ channel: 'D0MATHILDE', user: 'U0MATHILDE' }]);
  });
});

describe("Slack's actions door", () => {
  it('reads a press of an option\'s button under a question, naming its fleet message, with its raw body to check its signature', async () => {
    const { server, pressed } = await aServer();
    const payload = { type: 'block_actions', api_app_id: 'A01', team: { id: 'T0ACME' }, user: { id: 'U0MATHILDE' }, container: { type: 'message', channel_id: 'D0MATHILDE', message_ts: '1730020000.000001' }, actions: [{ action_id: 'answer-2', block_id: 'msg_01m3tbfspe96yf1rnr4ank0002', value: '2' }] };
    const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();

    const answer = await server.inject({ method: 'POST', url: SLACK_ACTIONS_PATH, headers: { ...signed(body, 'signing-A01'), 'content-type': 'application/x-www-form-urlencoded' }, payload: body });

    expect(answer.statusCode).toBe(200);
    expect(pressed.map(({ appId, teamId, userId, channel, messageTs, messageId, option, body: raw }) => ({ appId, teamId, userId, channel, messageTs, messageId, option, raw }))).toEqual([{ appId: 'A01', teamId: 'T0ACME', userId: 'U0MATHILDE', channel: 'D0MATHILDE', messageTs: '1730020000.000001', messageId: 'msg_01m3tbfspe96yf1rnr4ank0002', option: 2, raw: body }]);
  });
});

describe("a linked person's message at the events door", () => {
  it('is kept by its event id with its text, thread and files, and answered 200', async () => {
    const { server, links, events } = await aServer();
    await links.add(aSlackLink());
    const body = JSON.stringify({
      type: 'event_callback',
      api_app_id: 'A02',
      team_id: 'T0ACME',
      event_id: 'Ev03',
      event: { type: 'message', subtype: 'file_share', channel_type: 'im', channel: 'D0MATHILDE', user: 'U0MATHILDE', text: '*soon*?', ts: '1730019700.000200', thread_ts: '1730019600.000100', files: [{ id: 'F01', name: 'notes.pdf', permalink: 'https://acme.slack.com/files/F01' }] },
    });

    const answer = await server.inject({ method: 'POST', url: SLACK_EVENTS_PATH, headers: signed(body, 'signing-A02'), payload: body });

    expect(answer.statusCode).toBe(200);
    expect(events.held.map(({ eventId, ts, threadTs, markdown }) => ({ eventId, ts, threadTs, markdown }))).toEqual([{ eventId: 'Ev03', ts: '1730019700.000200', threadTs: '1730019600.000100', markdown: '**soon**?\n\n[notes.pdf](https://acme.slack.com/files/F01)' }]);
  });
});

// Sign in with Slack sends the person back to the gateway (gateway scopes
// 9.3); they go on to the Overview, which says how the link went by its
// outcome, naming the first link of a second one refused.

describe("Sign in with Slack's way back", () => {
  it('sends the person to the Overview, linked', async () => {
    const { server } = await aServer(() => Promise.resolve(ok({ fleetId: FLEET_ID })));

    const answer = await server.inject({ method: 'GET', url: `${SLACK_LINK_PATH}?code=code-1&state=sealed` });

    expect({ status: answer.statusCode, location: answer.headers.location }).toEqual({ status: 302, location: `/overview?fleet=${FLEET_ID}&slack=linked` });
  });

  it('names the first link of a second one refused', async () => {
    const { server } = await aServer(() => Promise.resolve(err({ kind: 'SLACK_USER_LINKED' as const, message: 'This Slack account is linked to joris in this fleet already', fleetId: FLEET_ID, name: 'joris' })));

    const answer = await server.inject({ method: 'GET', url: `${SLACK_LINK_PATH}?code=code-1&state=sealed` });

    expect(answer.headers.location).toBe(`/overview?fleet=${FLEET_ID}&slack=slack-user-linked&name=joris`);
  });

  it("completes the link with the shared sign-in the browser holds, so a link is bound to the account that started it", async () => {
    const completing: unknown[] = [];
    const { server } = await aServer((input) => {
      completing.push(input);
      return Promise.resolve(ok({ fleetId: FLEET_ID }));
    });

    await server.inject({ method: 'GET', url: `${SLACK_LINK_PATH}?code=code-1&state=sealed`, headers: { cookie: 'other=1; aeolus_account_session=sign-in-mathilde' } });

    expect(completing).toEqual([{ code: 'code-1', state: 'sealed', signIn: 'sign-in-mathilde' }]);
  });

  it('completes the link with no sign-in when the browser holds none', async () => {
    const completing: unknown[] = [];
    const { server } = await aServer((input) => {
      completing.push(input);
      return Promise.resolve(ok({ fleetId: FLEET_ID }));
    });

    await server.inject({ method: 'GET', url: `${SLACK_LINK_PATH}?code=code-1&state=sealed` });

    expect(completing).toEqual([{ code: 'code-1', state: 'sealed', signIn: undefined }]);
  });

  it('says the person cancelled on Slack\'s screen', async () => {
    const { server } = await aServer();

    const answer = await server.inject({ method: 'GET', url: `${SLACK_LINK_PATH}?error=access_denied&state=sealed` });

    expect(answer.headers.location).toBe('/overview?slack=cancelled');
  });
});
