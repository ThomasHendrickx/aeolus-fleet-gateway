/**
 * Slack's Web API for app management (gateway scopes 9.1, 9.2): rotating
 * the app configuration token, making and removing an app from a manifest,
 * and turning an install's code into its bot token. Every method answers
 * JSON with ok and, when not, Slack's own error code; a 429 says when to
 * ask again in Retry-After.
 */
import { z } from 'zod';

import { err, ok, type Result } from '../../core/shared/result.js';
import type { SlackRefusal, SlackTooling } from '../../core/slack/ports.js';
import type { SlackAppDescription } from '../../core/slack/slack-app.js';

/** Slack's public Web API. */
export const SLACK_API_URL = 'https://slack.com/api';

/** How long the gateway waits for Slack. */
const SLACK_TIMEOUT_MS = 10_000;

const SECOND_MS = 1000;

/** Waited when a 429 names no Retry-After. */
const DEFAULT_RETRY_AFTER_SECONDS = 60;

const refusedSchema = z.object({ ok: z.literal(false), error: z.string() });

const rotatedSchema = z.object({ ok: z.literal(true), token: z.string(), refresh_token: z.string(), team_id: z.string(), exp: z.number() });

const madeSchema = z.object({
  ok: z.literal(true),
  app_id: z.string(),
  credentials: z.object({ client_id: z.string(), client_secret: z.string(), signing_secret: z.string() }),
  oauth_authorize_url: z.string(),
});

const installedSchema = z.object({ ok: z.literal(true), access_token: z.string(), bot_user_id: z.string(), app_id: z.string(), team: z.object({ id: z.string(), name: z.string() }) });

/** Slack's app manifest for what the gateway asks it to make: a bot with a direct messages tab, its scopes, and the install redirect. */
function manifestOf(description: SlackAppDescription) {
  return {
    display_information: { name: description.name, description: description.description },
    features: { bot_user: { display_name: description.name, always_online: true }, app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false } },
    oauth_config: { redirect_urls: [description.redirectUrl], scopes: { bot: [...description.botScopes] } },
    settings: { org_deploy_enabled: false, socket_mode_enabled: false, token_rotation_enabled: false },
  };
}

export function createSlackTooling(options: { apiUrl: string }): SlackTooling {
  /** Calls a Web API method with a form, as the token given if any, and parses what it answers OK. */
  const call = async <T>(method: string, form: Record<string, string>, answers: z.ZodType<T>, token?: string): Promise<Result<T, SlackRefusal>> => {
    let response: Response;
    try {
      response = await fetch(`${options.apiUrl}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
        body: new URLSearchParams(form),
        signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
      });
    } catch (error) {
      return err({ kind: 'unavailable', message: error instanceof Error ? error.message : String(error) });
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      return err({ kind: 'rateLimited', retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : DEFAULT_RETRY_AFTER_SECONDS });
    }
    const body: unknown = await response.json().catch(() => undefined);
    const answered = answers.safeParse(body);
    if (answered.success) {
      return ok(answered.data);
    }
    const refused = refusedSchema.safeParse(body);
    return err(refused.success ? { kind: 'refused', error: refused.data.error } : { kind: 'unavailable', message: `Slack answered ${String(response.status)} with no answer the gateway reads` });
  };

  return {
    rotateConfigurationToken: async (refreshToken) => {
      const rotated = await call('tooling.tokens.rotate', { refresh_token: refreshToken }, rotatedSchema);
      return rotated.isOk ? ok({ token: { accessToken: rotated.value.token, refreshToken: rotated.value.refresh_token, expiresAt: new Date(rotated.value.exp * SECOND_MS) }, teamId: rotated.value.team_id }) : rotated;
    },
    makeApp: async (accessToken, description) => {
      const made = await call('apps.manifest.create', { manifest: JSON.stringify(manifestOf(description)) }, madeSchema, accessToken);
      if (!made.isOk) {
        return made;
      }
      const { app_id: appId, credentials, oauth_authorize_url: installUrl } = made.value;
      return ok({ appId, clientId: credentials.client_id, clientSecret: credentials.client_secret, signingSecret: credentials.signing_secret, installUrl });
    },
    removeApp: async (accessToken, appId) => {
      const removed = await call('apps.manifest.delete', { app_id: appId }, z.object({ ok: z.literal(true) }), accessToken);
      return removed.isOk ? ok(undefined) : removed;
    },
    completeInstall: async ({ clientId, clientSecret, code, redirectUrl }) => {
      const installed = await call('oauth.v2.access', { client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUrl }, installedSchema);
      if (!installed.isOk) {
        return installed;
      }
      const { app_id: appId, team, access_token: botToken, bot_user_id: botUserId } = installed.value;
      return ok({ appId, teamId: team.id, teamName: team.name, botToken, botUserId });
    },
  };
}
