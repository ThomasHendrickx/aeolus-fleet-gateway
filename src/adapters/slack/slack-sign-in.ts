/**
 * Sign in with Slack (OpenID Connect), through an app's client credentials
 * (gateway scopes 9.3): Slack's sign-in screen for the workspace, then the
 * code it sends back turned into a user token (openid.connect.token) and
 * that token into who signed in (openid.connect.userInfo).
 */
import { z } from 'zod';

import { ok } from '../../core/shared/result.js';
import type { SlackSignIn } from '../../core/slack/ports.js';
import { SIGN_IN_SCOPES } from '../../core/slack/slack-app.js';
import { createSlackCall } from './slack-call.js';

/** Slack's sign-in screen, beside its Web API on Slack's own host. */
const AUTHORIZE_PATH = '/openid/connect/authorize';

const tokenSchema = z.object({ ok: z.literal(true), access_token: z.string() });

const userInfoSchema = z.object({ ok: z.literal(true), 'https://slack.com/user_id': z.string(), 'https://slack.com/team_id': z.string(), name: z.string() });

export function createSlackSignIn(options: { apiUrl: string }): SlackSignIn {
  const call = createSlackCall(options.apiUrl);
  return {
    authorizeUrl: ({ clientId, redirectUrl, state, teamId }) => {
      const url = new URL(AUTHORIZE_PATH, options.apiUrl);
      url.search = new URLSearchParams({ response_type: 'code', scope: SIGN_IN_SCOPES.join(' '), client_id: clientId, redirect_uri: redirectUrl, state, team: teamId }).toString();
      return url.toString();
    },
    complete: async ({ clientId, clientSecret, code, redirectUrl }) => {
      const token = await call({ method: 'openid.connect.token', form: { client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUrl } }, tokenSchema);
      if (!token.isOk) {
        return token;
      }
      const user = await call({ method: 'openid.connect.userInfo', form: {}, token: token.value.access_token }, userInfoSchema);
      return user.isOk ? ok({ teamId: user.value['https://slack.com/team_id'], userId: user.value['https://slack.com/user_id'], name: user.value.name }) : user;
    },
  };
}
