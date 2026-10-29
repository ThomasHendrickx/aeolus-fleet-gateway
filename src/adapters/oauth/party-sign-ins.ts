/**
 * A party's outside authorization server, as the gateway, a confidential
 * OAuth client, reaches it for each person's sign-in (MCP authorization
 * 2026-07-28, decision 0067): the authorize address of the code flow with
 * PKCE S256 and the resource (RFC 8707), the code redeemed at the token
 * endpoint with the client's secret (client_secret_post, as the client was
 * registered), and a token revoked (RFC 7009). The ID token's claims are
 * read, not checked: the core checks they name the party's issuer and
 * client.
 */
import { z } from 'zod';

import type { IdTokenClaims, PartySignIns, TokenRequestFailure } from '../../core/party-grants/ports.js';
import { err, ok, type Result } from '../../core/shared/result.js';
import type { SignInClient } from '../../core/vault/credential.js';

/** How long the gateway waits for each answer of the authorization server. */
const ANSWER_WAIT_MS = 10_000;

/** A token response (RFC 6749 5.1), by its own field names; an ID token where OpenID Connect answers one. */
const tokensSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().regex(/^bearer$/i),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().optional(),
  id_token: z.string().optional(),
});
const tokenErrorSchema = z.object({ error: z.string(), error_description: z.string().optional() });
const idTokenSchema = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  sub: z.string().min(1),
  email: z.string().optional(),
  preferred_username: z.string().optional(),
  name: z.string().optional(),
});

/** The parts of a JWT: its header, its claims and its signature. */
const JWT_PARTS = 3;

function reasonOf(error: unknown): string {
  if (error instanceof Error) {
    return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
  }
  return String(error);
}

/** The claims of an ID token, read from its payload; none when it is no JWT with OpenID Connect's claims. */
function idTokenClaimsOf(idToken: string): IdTokenClaims | undefined {
  const parts = idToken.split('.');
  if (parts.length !== JWT_PARTS) {
    return undefined;
  }
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  const read = idTokenSchema.safeParse(claims);
  if (!read.success) {
    return undefined;
  }
  const { iss, aud, sub, email, preferred_username: username, name } = read.data;
  return { issuer: iss, audiences: typeof aud === 'string' ? [aud] : aud, subject: sub, name: email ?? username ?? name ?? null };
}

/** The client's own credentials, as it authenticates at the token and revocation endpoints. */
function clientAuthenticationOf(client: SignInClient): Record<string, string> {
  return client.clientSecret === null ? { client_id: client.clientId } : { client_id: client.clientId, client_secret: client.clientSecret };
}

async function posted(url: string, form: Record<string, string>): Promise<Result<Response, TokenRequestFailure>> {
  try {
    return ok(await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(form), signal: AbortSignal.timeout(ANSWER_WAIT_MS) }));
  } catch (error) {
    return err({ kind: 'unreachable', reason: reasonOf(error) });
  }
}

export function createPartySignIns(): PartySignIns {
  return {
    authorizeUrl(client, { state, codeChallenge, redirectUri }) {
      const url = new URL(client.authorizationEndpoint);
      for (const [name, value] of Object.entries({
        response_type: 'code',
        client_id: client.clientId,
        redirect_uri: redirectUri,
        scope: client.scope,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        resource: client.resource,
      })) {
        url.searchParams.set(name, value);
      }
      return url.toString();
    },

    async redeemCode(client, { code, verifier, redirectUri }) {
      const answered = await posted(client.tokenEndpoint, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, resource: client.resource, ...clientAuthenticationOf(client) });
      if (!answered.isOk) {
        return answered;
      }
      const response = answered.value;
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        const refusal = tokenErrorSchema.safeParse(body);
        return refusal.success
          ? err({ kind: 'refused', error: refusal.data.error, reason: [refusal.data.error, refusal.data.error_description].filter((part) => part !== undefined).join(': ') })
          : err({ kind: 'unreachable', reason: `HTTP ${String(response.status)}` });
      }
      const tokens = tokensSchema.safeParse(body);
      if (!tokens.success) {
        return err({ kind: 'refused', error: 'invalid_response', reason: 'the token endpoint answered no bearer access token' });
      }
      const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresInSeconds, id_token: idToken } = tokens.data;
      const claims = idToken === undefined ? null : idTokenClaimsOf(idToken);
      if (claims === undefined) {
        return err({ kind: 'refused', error: 'invalid_response', reason: 'the token endpoint answered an ID token that could not be read' });
      }
      return ok({ accessToken, refreshToken: refreshToken ?? null, expiresInSeconds: expiresInSeconds ?? null, idToken: claims });
    },

    async revoke(client, token) {
      const answered = await posted(client.revocationEndpoint, { token, ...clientAuthenticationOf(client) });
      if (!answered.isOk) {
        return err({ reason: answered.error.reason });
      }
      await answered.value.body?.cancel();
      return answered.value.ok ? ok(undefined) : err({ reason: `HTTP ${String(answered.value.status)}` });
    },
  };
}
