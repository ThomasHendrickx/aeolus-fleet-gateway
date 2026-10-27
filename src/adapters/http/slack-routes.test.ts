import { createHmac } from 'node:crypto';

import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { aSlackApp, memorySlackApps } from '../../../test/support/slack-fakes.js';
import { err } from '../../core/shared/result.js';
import { createTakeSlackEvent } from '../../core/slack/take-slack-event.js';
import { createSlackSignatures } from '../crypto/slack-signatures.js';
import { registerSlackRoutes, SLACK_EVENTS_PATH } from './slack-routes.js';

// Slack's events door (gateway scopes 9.2, 9.4 step 1): Slack checks the
// address with a challenge as it makes an app, before the gateway knows
// the app's signing secret; every other event is taken only signed.

const NOW = new Date('2026-10-27T09:00:00.000Z');

/** Signs a body as Slack does, with the app's signing secret: v0= and the hex HMAC-SHA256 of v0, the timestamp and the body. */
function signed(body: string, secret: string, timestamp = String(NOW.getTime() / 1000)) {
  return { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`, 'content-type': 'application/json' };
}

async function aServer() {
  const apps = memorySlackApps();
  await apps.save(aSlackApp({ appId: 'A02', shipId: 'shp_01m3tbfspe96yf1rnr4ank9r1n', name: 'release-notes', bot: { token: 'xoxb-2', userId: 'U02' } }));
  const server = Fastify();
  registerSlackRoutes(server, { completeInstall: () => Promise.resolve(err({ kind: 'INSTALL_REFUSED' as const, message: 'unused' })), takeSlackEvent: createTakeSlackEvent({ apps, signatures: createSlackSignatures(), clock: { now: () => NOW } }) });
  return { server, apps };
}

describe("Slack's events door", () => {
  it("answers Slack's address check with its challenge", async () => {
    const { server } = await aServer();

    const answer = await server.inject({ method: 'POST', url: SLACK_EVENTS_PATH, headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ type: 'url_verification', token: 't', challenge: 'the-challenge' }) });

    expect({ status: answer.statusCode, body: answer.json() }).toEqual({ status: 200, body: { challenge: 'the-challenge' } });
  });

  it("takes an app_uninstalled signed with the app's signing secret: the bot shows Removed in Slack", async () => {
    const { server, apps } = await aServer();
    const body = JSON.stringify({ type: 'event_callback', api_app_id: 'A02', team_id: 'T0ACME', event_id: 'Ev01', event: { type: 'app_uninstalled' } });

    const answer = await server.inject({ method: 'POST', url: SLACK_EVENTS_PATH, headers: signed(body, 'signing-A02'), payload: body });

    expect({ status: answer.statusCode, removedInSlackAt: apps.held[0]?.removedInSlackAt }).toEqual({ status: 200, removedInSlackAt: NOW });
  });

  it('refuses an event not signed with the app\'s signing secret, 401, changing nothing', async () => {
    const { server, apps } = await aServer();
    const body = JSON.stringify({ type: 'event_callback', api_app_id: 'A02', event: { type: 'app_uninstalled' } });

    const answer = await server.inject({ method: 'POST', url: SLACK_EVENTS_PATH, headers: signed(body, 'another-secret'), payload: body });

    expect({ status: answer.statusCode, removedInSlackAt: apps.held[0]?.removedInSlackAt }).toEqual({ status: 401, removedInSlackAt: null });
  });
});
