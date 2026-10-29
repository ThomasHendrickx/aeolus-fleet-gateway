/**
 * Slack's Web API for app management (gateway scopes 9.1, 9.2): rotating
 * the app configuration token, making and removing an app from a manifest,
 * and turning an install's code into its bot token.
 */
import { z } from 'zod';

import { ok } from '../../core/shared/result.js';
import type { SlackTooling } from '../../core/slack/ports.js';
import type { SlackAppDescription } from '../../core/slack/slack-app.js';
import { createSlackCall } from './slack-call.js';

/** Slack's public Web API. */
export const SLACK_API_URL = 'https://slack.com/api';

const SECOND_MS = 1000;

const rotatedSchema = z.object({ ok: z.literal(true), token: z.string(), refresh_token: z.string(), team_id: z.string(), exp: z.number() });

const madeSchema = z.object({
  ok: z.literal(true),
  app_id: z.string(),
  credentials: z.object({ client_id: z.string(), client_secret: z.string(), signing_secret: z.string() }),
  oauth_authorize_url: z.string(),
});

const installedSchema = z.object({ ok: z.literal(true), access_token: z.string(), bot_user_id: z.string(), app_id: z.string(), team: z.object({ id: z.string(), name: z.string() }) });

/** Slack's app manifest for what the gateway asks it to make: a bot with a direct messages tab, its scopes and any user scopes, the redirects, and the events Slack sends the gateway. */
function manifestOf(description: SlackAppDescription) {
  return {
    display_information: { name: description.name, description: description.description },
    features: { bot_user: { display_name: description.name, always_online: true }, app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false } },
    oauth_config: { redirect_urls: [...description.redirectUrls], scopes: { bot: [...description.botScopes], ...(description.userScopes.length === 0 ? {} : { user: [...description.userScopes] }) } },
    settings: {
      event_subscriptions: { request_url: description.events.url, bot_events: [...description.events.botEvents] },
      interactivity: { is_enabled: true, request_url: description.actionsUrl },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}

export function createSlackTooling(options: { apiUrl: string }): SlackTooling {
  const call = createSlackCall(options.apiUrl);

  return {
    rotateConfigurationToken: async (refreshToken) => {
      const rotated = await call({ method: 'tooling.tokens.rotate', form: { refresh_token: refreshToken } }, rotatedSchema);
      return rotated.isOk ? ok({ token: { accessToken: rotated.value.token, refreshToken: rotated.value.refresh_token, expiresAt: new Date(rotated.value.exp * SECOND_MS) }, teamId: rotated.value.team_id }) : rotated;
    },
    makeApp: async (accessToken, description) => {
      const made = await call({ method: 'apps.manifest.create', form: { manifest: JSON.stringify(manifestOf(description)) }, token: accessToken }, madeSchema);
      if (!made.isOk) {
        return made;
      }
      const { app_id: appId, credentials, oauth_authorize_url: installUrl } = made.value;
      return ok({ appId, clientId: credentials.client_id, clientSecret: credentials.client_secret, signingSecret: credentials.signing_secret, installUrl });
    },
    renameApp: async (accessToken, { appId, description }) => {
      const renamed = await call({ method: 'apps.manifest.update', form: { app_id: appId, manifest: JSON.stringify(manifestOf(description)) }, token: accessToken }, z.object({ ok: z.literal(true) }));
      return renamed.isOk ? ok(undefined) : renamed;
    },
    removeApp: async (accessToken, appId) => {
      const removed = await call({ method: 'apps.manifest.delete', form: { app_id: appId }, token: accessToken }, z.object({ ok: z.literal(true) }));
      return removed.isOk ? ok(undefined) : removed;
    },
    completeInstall: async ({ clientId, clientSecret, code, redirectUrl }) => {
      const installed = await call({ method: 'oauth.v2.access', form: { client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUrl } }, installedSchema);
      if (!installed.isOk) {
        return installed;
      }
      const { app_id: appId, team, access_token: botToken, bot_user_id: botUserId } = installed.value;
      return ok({ appId, teamId: team.id, teamName: team.name, botToken, botUserId });
    },
  };
}
