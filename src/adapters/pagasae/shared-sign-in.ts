/**
 * pagasae as the account sign-in every Aeolus app shares (aeolus-fleet's
 * header design H5, pagasae S2 to S4), for the gateway's pages, an app in
 * its APP_CLIENTS: the code flow with PKCE naming no fleet, the token
 * exchange of the shared sign-in for one fleet's account token (RFC 8693),
 * the apps and fleets the account may open (H1), and revocation (RFC 7009).
 * pagasae refusing the gateway's own credentials is a setting to fix, so
 * it throws; everything else is an answer.
 */
import { accountTokenClaimsSchema, idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { SharedSignIn } from '../../core/account-sign-in/ports.js';
import { err, ok } from '../../core/shared/result.js';

const HTTP_SERVER_ERROR = 500;

const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const SIGN_IN_TOKEN_TYPE = 'urn:aeolus:params:oauth:token-type:sign-in';

/** The header pagasae reads the shared sign-in from on /api/apps. */
const SIGN_IN_HEADER = 'aeolus-sign-in';

const errorAnswerSchema = z.object({ error: z.string() });
const exchangeAnswerSchema = z.object({ access_token: z.string() });
const appSchema = z.object({ app: z.string(), url: z.string() });
const appsAnswerSchema = z.object({
  account: z.object({ id: z.string(), email: z.string() }),
  apps: z.array(appSchema),
  fleets: z.array(z.object({ id: idSchema('fleet'), name: z.string(), apps: z.array(appSchema) })),
});

function claimsOf(accountToken: string): unknown {
  const payload = accountToken.split('.')[1];
  if (payload === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

type Answer = { kind: 'answered'; status: number; body: unknown } | { kind: 'unavailable' };

export class PagasaeCredentialsRefused extends Error {
  override name = 'PagasaeCredentialsRefused';
}

export function createSharedSignIn(options: { url: string; clientId: string; clientSecret: string; redirectUri: string; timeoutMs: number }): SharedSignIn {
  const credentials = { client_id: options.clientId, client_secret: options.clientSecret };

  /** One call of pagasae: its status and body, unavailable when it did not answer or failed. invalid_client throws. */
  const call = async (path: string, init: RequestInit): Promise<Answer> => {
    let response: Response;
    try {
      response = await fetch(`${options.url}${path}`, { ...init, redirect: 'manual', signal: AbortSignal.timeout(options.timeoutMs) });
    } catch {
      return { kind: 'unavailable' };
    }
    const body: unknown = await response.json().catch(() => undefined);
    if (response.status >= HTTP_SERVER_ERROR) {
      return { kind: 'unavailable' };
    }
    const refusal = errorAnswerSchema.safeParse(body);
    if (refusal.success && refusal.data.error === 'invalid_client') {
      throw new PagasaeCredentialsRefused("pagasae refused the gateway's app credentials (invalid_client): check PAGASAE_APP_CLIENT_ID and PAGASAE_APP_CLIENT_SECRET");
    }
    return { kind: 'answered', status: response.status, body };
  };

  const form = (fields: Record<string, string>): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ ...fields, ...credentials }).toString(),
  });

  const errorOf = (answer: Answer): string | undefined => (answer.kind === 'answered' ? errorAnswerSchema.safeParse(answer.body).data?.error : undefined);

  return {
    authorizeUrl: ({ state, codeChallenge }) => {
      const url = new URL(`${options.url}/oauth/authorize`);
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: options.clientId,
        redirect_uri: options.redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        scope: 'openid',
      }).toString();
      return url.toString();
    },
    redeemCode: async ({ code, verifier }) => {
      const answer = await call('/oauth/token', form({ grant_type: 'authorization_code', code, redirect_uri: options.redirectUri, code_verifier: verifier }));
      if (answer.kind === 'answered' && answer.status === 200) {
        return ok(undefined);
      }
      return err({ reason: errorOf(answer) ?? (answer.kind === 'unavailable' ? 'pagasae did not answer' : `pagasae answered ${String(answer.status)}`) });
    },
    accountToken: async ({ signIn, fleetId }) => {
      const answer = await call('/oauth/token', form({ grant_type: TOKEN_EXCHANGE, subject_token: signIn, subject_token_type: SIGN_IN_TOKEN_TYPE, resource: fleetId }));
      if (answer.kind === 'unavailable') {
        return err({ kind: 'unavailable' });
      }
      if (answer.status !== 200) {
        return err(errorOf(answer) === 'invalid_target' ? { kind: 'noRights' } : { kind: 'signedOut' });
      }
      const token = exchangeAnswerSchema.safeParse(answer.body);
      const claims = accountTokenClaimsSchema.safeParse(token.success ? claimsOf(token.data.access_token) : undefined);
      if (!token.success || !claims.success) {
        return err({ kind: 'unavailable' });
      }
      const { accountId, personShipId, scopes, endsAt } = claims.data;
      return ok({ accountToken: token.data.access_token, endsAt, accountId, personShipId, scopes });
    },
    apps: async (signIn) => {
      const basic = Buffer.from(`${encodeURIComponent(options.clientId)}:${encodeURIComponent(options.clientSecret)}`).toString('base64');
      const answer = await call('/api/apps', { method: 'GET', headers: { authorization: `Basic ${basic}`, [SIGN_IN_HEADER]: signIn, accept: 'application/json' } });
      if (answer.kind === 'unavailable') {
        return err({ kind: 'unavailable' });
      }
      const apps = appsAnswerSchema.safeParse(answer.body);
      if (answer.status !== 200 || !apps.success) {
        return err(answer.status === 200 ? { kind: 'unavailable' } : { kind: 'signedOut' });
      }
      return ok({ account: apps.data.account, apps: apps.data.apps, fleets: apps.data.fleets.map((fleet) => ({ fleetId: fleet.id, name: fleet.name, apps: fleet.apps })) });
    },
    revoke: async (signIn) => {
      const answer = await call('/oauth/revoke', form({ token: signIn }));
      return answer.kind === 'answered' && answer.status === 200 ? ok(undefined) : err({ kind: 'unavailable' });
    },
  };
}
