import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startFakeSlack, type FakeSlack } from '../../../test/support/fake-slack.js';
import { gatewayBotDescription, shipBotDescription } from '../../core/slack/slack-app.js';
import { createSlackTooling } from './slack-tooling.js';

// Slack's Web API as the gateway calls it for app management (gateway
// scopes 9.1, 9.2), against the Slack double: every refusal is Slack's own
// error code, a 429 its Retry-After.

const REDIRECT_URL = 'https://gateway.acme.test/gw/slack/install';

let slack: FakeSlack;

beforeEach(async () => {
  slack = await startFakeSlack();
  slack.issueRefreshToken('xoxe-1-first');
});

afterEach(async () => {
  await slack.stop();
});

describe("Slack's app management", () => {
  it('rotates a configuration token for the next pair, naming the workspace and when the access token ends', async () => {
    const rotated = await createSlackTooling({ apiUrl: slack.apiUrl }).rotateConfigurationToken('xoxe-1-first');

    expect(rotated.isOk && { accessToken: rotated.value.token.accessToken, refreshToken: rotated.value.token.refreshToken, teamId: rotated.value.teamId }).toEqual({
      accessToken: 'xoxe.xoxp-1-1',
      refreshToken: 'xoxe-1-rotated-1',
      teamId: 'T0ACME',
    });
    expect(rotated.isOk && Math.round((rotated.value.token.expiresAt.getTime() - Date.now()) / 60_000)).toBe(720);
  });

  it("answers Slack's own error code when it refuses a refresh token", async () => {
    await expect(createSlackTooling({ apiUrl: slack.apiUrl }).rotateConfigurationToken('xoxe-1-spent')).resolves.toEqual({ isOk: false, error: { kind: 'refused', error: 'invalid_refresh_token' } });
  });

  it('makes an app from a manifest with the bot user, its scopes and the install redirect, then removes it', async () => {
    const tooling = createSlackTooling({ apiUrl: slack.apiUrl });
    const rotated = await tooling.rotateConfigurationToken('xoxe-1-first');
    const accessToken = rotated.isOk ? rotated.value.token.accessToken : '';

    const made = await tooling.makeApp(accessToken, gatewayBotDescription('Acme', REDIRECT_URL));

    expect(made).toEqual({
      isOk: true,
      value: { appId: 'A01', clientId: 'client-A01', clientSecret: 'secret-A01', signingSecret: 'signing-A01', installUrl: `${slack.url}/oauth/v2/authorize?client_id=client-A01&scope=chat%3Awrite` },
    });
    expect(slack.apps.get('A01')?.manifest).toEqual({
      display_information: { name: 'Acme', description: 'What waits for you in the Acme fleet of Aeolus' },
      features: { bot_user: { display_name: 'Acme', always_online: true }, app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false } },
      oauth_config: { redirect_urls: [REDIRECT_URL], scopes: { bot: ['chat:write', 'im:history', 'im:write'] } },
      settings: { org_deploy_enabled: false, socket_mode_enabled: false, token_rotation_enabled: false },
    });
    await expect(tooling.removeApp(accessToken, 'A01')).resolves.toEqual({ isOk: true, value: undefined });
    expect(slack.apps.get('A01')?.isRemoved).toBe(true);
  });

  it("makes a ship's bot with its events sent to the gateway, and renames it with its whole manifest", async () => {
    const tooling = createSlackTooling({ apiUrl: slack.apiUrl });
    const rotated = await tooling.rotateConfigurationToken('xoxe-1-first');
    const accessToken = rotated.isOk ? rotated.value.token.accessToken : '';
    const addresses = { installRedirectUrl: REDIRECT_URL, eventsUrl: 'https://gateway.acme.test/gw/slack/events' };
    await tooling.makeApp(accessToken, shipBotDescription({ name: 'release-notes', summary: 'Writes the release notes' }, addresses));

    await expect(tooling.renameApp(accessToken, 'A01', shipBotDescription({ name: 'changelog', summary: 'Writes the release notes' }, addresses))).resolves.toEqual({ isOk: true, value: undefined });

    expect(slack.apps.get('A01')?.manifest).toEqual({
      display_information: { name: 'changelog', description: 'Writes the release notes' },
      features: { bot_user: { display_name: 'changelog', always_online: true }, app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false } },
      oauth_config: { redirect_urls: [REDIRECT_URL], scopes: { bot: ['chat:write', 'im:history', 'app_mentions:read', 'reactions:write'] } },
      settings: {
        event_subscriptions: { request_url: 'https://gateway.acme.test/gw/slack/events', bot_events: ['message.im', 'app_mention', 'app_uninstalled', 'tokens_revoked'] },
        org_deploy_enabled: false,
        socket_mode_enabled: false,
        token_rotation_enabled: false,
      },
    });
  });

  it("answers rate limited with Slack's Retry-After", async () => {
    slack.rateLimit('apps.manifest.create', 30);

    await expect(createSlackTooling({ apiUrl: slack.apiUrl }).makeApp('xoxe.xoxp-1-1', gatewayBotDescription('Acme', REDIRECT_URL))).resolves.toEqual({ isOk: false, error: { kind: 'rateLimited', retryAfterSeconds: 30 } });
  });

  it("turns an install's code into the bot token, with the workspace's name", async () => {
    const tooling = createSlackTooling({ apiUrl: slack.apiUrl });
    const rotated = await tooling.rotateConfigurationToken('xoxe-1-first');
    const made = await tooling.makeApp(rotated.isOk ? rotated.value.token.accessToken : '', gatewayBotDescription('Acme', REDIRECT_URL));
    const back = await fetch(made.isOk ? `${made.value.installUrl}&state=s` : '', { redirect: 'manual' });
    const code = new URL(back.headers.get('location') ?? '').searchParams.get('code') ?? '';

    await expect(tooling.completeInstall({ clientId: 'client-A01', clientSecret: 'secret-A01', code, redirectUrl: REDIRECT_URL })).resolves.toEqual({
      isOk: true,
      value: { appId: 'A01', teamId: 'T0ACME', teamName: 'Acme', botToken: 'xoxb-A01', botUserId: 'U0A01' },
    });
  });

  it('answers unavailable when Slack does not answer', async () => {
    await slack.stop();

    await expect(createSlackTooling({ apiUrl: slack.apiUrl }).rotateConfigurationToken('xoxe-1-first')).resolves.toMatchObject({ isOk: false, error: { kind: 'unavailable' } });
    slack = await startFakeSlack();
  });
});
