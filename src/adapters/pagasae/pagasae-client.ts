/**
 * pagasae, the one identity provider (decision 0054), as the gateway's
 * OpenID Connect provider: its authorize address, and its token endpoint,
 * where the gateway redeems a code with its own secret (client_secret_post).
 * The access token pagasae answers is the account token for the fleet the
 * person picked; the gateway reads what it names, and core checks its
 * signature on every call it is presented to.
 */
import { idSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import { err, ok } from '../../core/shared/result.js';
import type { Pagasae } from '../../core/sign-in/ports.js';

const MILLISECONDS_PER_SECOND = 1000;

const tokenAnswerSchema = z.object({ access_token: z.string(), refresh_token: z.string() });
const errorAnswerSchema = z.object({ error: z.string() });

/** What the gateway reads of an account token: its fleet (the audience), its account, its person ship there, and its end. */
const accountTokenSchema = z.object({ aud: idSchema('fleet'), sub: z.string().min(1), person_ship: idSchema('ship').optional(), exp: z.number() });

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

export function createPagasae(options: { url: string; clientId: string; clientSecret: string; redirectUri: string; timeoutMs: number }): Pagasae {
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
      let response: Response;
      try {
        response = await fetch(`${options.url}/oauth/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: options.redirectUri, code_verifier: verifier, client_id: options.clientId, client_secret: options.clientSecret }).toString(),
          redirect: 'manual',
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch {
        return err({ reason: 'pagasae did not answer' });
      }
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        const refusal = errorAnswerSchema.safeParse(body);
        return err({ reason: refusal.success ? refusal.data.error : `pagasae answered ${String(response.status)}` });
      }
      const answer = tokenAnswerSchema.safeParse(body);
      const claims = accountTokenSchema.safeParse(answer.success ? claimsOf(answer.data.access_token) : undefined);
      if (!answer.success || !claims.success) {
        return err({ reason: 'pagasae answered no account token the gateway can read' });
      }
      return ok({
        accountToken: answer.data.access_token,
        accountTokenExpiresAt: new Date(claims.data.exp * MILLISECONDS_PER_SECOND),
        refreshToken: answer.data.refresh_token,
        fleetId: claims.data.aud,
        accountId: claims.data.sub,
        personShipId: claims.data.person_ship ?? null,
      });
    },
  };
}
