/**
 * A party's issuer-bound outside OAuth client (decision 0074): code
 * redemption with PKCE S256, refresh with the resource (RFC 8707), and
 * revocation use the stored public, form-secret or Basic authentication
 * method. Registration-management credentials delete only owned clients.
 * The ID token's claims are
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
function clientAuthenticationOf(client: SignInClient): { form: Record<string, string>; headers: Record<string, string> } {
  switch (client.tokenEndpointAuthMethod) {
    case 'none':
      return { form: { client_id: client.clientId }, headers: {} };
    case 'client_secret_post':
      return { form: { client_id: client.clientId, client_secret: client.clientSecret ?? '' }, headers: {} };
    case 'client_secret_basic': {
      // RFC 6749 2.3.1 requires form encoding each credential before Base64.
      const encoded = (value: string) => new URLSearchParams({ value }).toString().slice('value='.length);
      const credentials = `${encoded(client.clientId)}:${encoded(client.clientSecret ?? '')}`;
      return { form: {}, headers: { authorization: `Basic ${Buffer.from(credentials).toString('base64')}` } };
    }
  }
}

/** The token endpoint's answer to a token request: the tokens it issued, its OAuth error, or no answer. */
async function tokensOf(response: Response): Promise<Result<z.infer<typeof tokensSchema>, TokenRequestFailure>> {
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const refusal = tokenErrorSchema.safeParse(body);
    return refusal.success
      ? err({ kind: 'refused', error: refusal.data.error, reason: [refusal.data.error, refusal.data.error_description].filter((part) => part !== undefined).join(': ') })
      : err({ kind: 'unreachable', reason: `HTTP ${String(response.status)}` });
  }
  const tokens = tokensSchema.safeParse(body);
  return tokens.success ? ok(tokens.data) : err({ kind: 'refused', error: 'invalid_response', reason: 'the token endpoint answered no bearer access token' });
}

async function posted(client: SignInClient, { url, form }: { url: string; form: Record<string, string> }): Promise<Result<Response, TokenRequestFailure>> {
  const authentication = clientAuthenticationOf(client);
  try {
    return ok(await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', ...authentication.headers }, body: new URLSearchParams({ ...form, ...authentication.form }), signal: AbortSignal.timeout(ANSWER_WAIT_MS) }));
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
      const answered = await posted(client, { url: client.tokenEndpoint, form: { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, resource: client.resource } });
      if (!answered.isOk) {
        return answered;
      }
      const tokens = await tokensOf(answered.value);
      if (!tokens.isOk) {
        return tokens;
      }
      const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresInSeconds, id_token: idToken } = tokens.value;
      const claims = idToken === undefined ? null : idTokenClaimsOf(idToken);
      if (claims === undefined) {
        return err({ kind: 'refused', error: 'invalid_response', reason: 'the token endpoint answered an ID token that could not be read' });
      }
      return ok({ accessToken, refreshToken: refreshToken ?? null, expiresInSeconds: expiresInSeconds ?? null, idToken: claims });
    },

    async refresh(client, refreshToken) {
      const answered = await posted(client, { url: client.tokenEndpoint, form: { grant_type: 'refresh_token', refresh_token: refreshToken, resource: client.resource } });
      if (!answered.isOk) {
        return answered;
      }
      const tokens = await tokensOf(answered.value);
      if (!tokens.isOk) {
        return tokens;
      }
      const { access_token: accessToken, refresh_token: rotated, expires_in: expiresInSeconds } = tokens.value;
      return ok({ accessToken, refreshToken: rotated ?? null, expiresInSeconds: expiresInSeconds ?? null });
    },

    async revoke(client, token) {
      if (!client.revocationEndpointAuthMethods.includes(client.tokenEndpointAuthMethod)) {
        return err({ reason: 'the revocation endpoint does not support the stored client authentication method' });
      }
      const answered = await posted(client, { url: client.revocationEndpoint, form: { token } });
      if (!answered.isOk) {
        return err({ reason: answered.error.reason });
      }
      await answered.value.body?.cancel();
      return answered.value.ok ? ok(undefined) : err({ reason: `HTTP ${String(answered.value.status)}` });
    },

    async deleteClient({ registrationClientUri, registrationAccessToken }) {
      try {
        const answered = await fetch(registrationClientUri, { method: 'DELETE', headers: { authorization: `Bearer ${registrationAccessToken}` }, signal: AbortSignal.timeout(ANSWER_WAIT_MS) });
        await answered.body?.cancel();
        return answered.ok ? ok(undefined) : err({ reason: `HTTP ${String(answered.status)}` });
      } catch (error) {
        return err({ reason: reasonOf(error) });
      }
    },
  };
}
