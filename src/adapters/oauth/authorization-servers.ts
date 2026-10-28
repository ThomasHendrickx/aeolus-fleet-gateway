/**
 * Outside MCP servers' authorization servers, as the gateway, an OAuth
 * client, reaches them (MCP authorization 2026-07-28, decision 0067). It
 * finds a server's authorization server from its 401's `resource_metadata`,
 * else its well-known protected resource metadata (RFC 9728), then the
 * authorization server's metadata (RFC 8414, else OpenID Connect), whose
 * issuer must be the one named; and registers a client by dynamic
 * registration (RFC 7591). The core decides what the answers allow.
 */
import { discoverAuthorizationServerMetadata, discoverOAuthProtectedResourceMetadata, extractWWWAuthenticateParams, IssuerMismatchError, type FetchLike } from '@modelcontextprotocol/client';
import { z } from 'zod';

import type { AuthorizationServers, DiscoveredSignIn } from '../../core/parties/ports.js';
import { err, ok } from '../../core/shared/result.js';

/** How long the gateway waits for each answer while it adds a server. */
const ANSWER_WAIT_MS = 10_000;
const HTTP_UNAUTHORIZED = 401;

/** The MCP request the gateway sends to find whether a server asks for a sign-in: an initialize, as any client's first. */
const INITIALIZE = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'aeolus-gateway', version: '1' } } };

/** RFC 7591's answer, by its own field names. */
const registeredSchema = z.object({
  client_id: z.string().min(1),
  client_secret: z.string().min(1).optional(),
  registration_client_uri: z.string().optional(),
  registration_access_token: z.string().optional(),
});
const registrationErrorSchema = z.object({ error: z.string(), error_description: z.string().optional() });

const timedFetch: FetchLike = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(ANSWER_WAIT_MS) });

function reasonOf(error: unknown): string {
  if (error instanceof Error) {
    return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
  }
  return String(error);
}

/** What the server's 401 names, if it answers one: where its protected resource metadata is, and the scope it asks. */
async function challengeOf(serverUrl: string): Promise<{ resourceMetadataUrl?: URL; scope?: string }> {
  const response = await timedFetch(serverUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(INITIALIZE),
  });
  await response.body?.cancel();
  if (response.status !== HTTP_UNAUTHORIZED) {
    return {};
  }
  const { resourceMetadataUrl, scope } = extractWWWAuthenticateParams(response);
  return { ...(resourceMetadataUrl === undefined ? {} : { resourceMetadataUrl }), ...(scope === undefined ? {} : { scope }) };
}

export function createAuthorizationServers(): AuthorizationServers {
  return {
    async discover(serverUrl) {
      let challenge: Awaited<ReturnType<typeof challengeOf>>;
      try {
        challenge = await challengeOf(serverUrl);
      } catch (error) {
        return err({ kind: 'unreachable', reason: reasonOf(error) });
      }
      let resourceMetadata: Awaited<ReturnType<typeof discoverOAuthProtectedResourceMetadata>>;
      try {
        resourceMetadata = await discoverOAuthProtectedResourceMetadata(serverUrl, challenge.resourceMetadataUrl === undefined ? {} : { resourceMetadataUrl: challenge.resourceMetadataUrl }, timedFetch);
      } catch (error) {
        return err({ kind: 'noAuthorizationServer', reason: `no protected resource metadata: ${reasonOf(error)}` });
      }
      const named = resourceMetadata.authorization_servers?.[0];
      if (named === undefined) {
        return err({ kind: 'noAuthorizationServer', reason: 'its protected resource metadata names no authorization server' });
      }
      let serverMetadata: Awaited<ReturnType<typeof discoverAuthorizationServerMetadata>>;
      try {
        serverMetadata = await discoverAuthorizationServerMetadata(named, { fetchFn: timedFetch });
      } catch (error) {
        return error instanceof IssuerMismatchError ? err({ kind: 'noServerMetadata', reason: reasonOf(error) }) : err({ kind: 'unreachable', reason: reasonOf(error) });
      }
      if (serverMetadata === undefined) {
        return err({ kind: 'noServerMetadata', reason: `${named} has no authorization server metadata` });
      }
      const discovered: DiscoveredSignIn = {
        resource: resourceMetadata.resource,
        challengeScope: challenge.scope ?? null,
        resourceScopes: resourceMetadata.scopes_supported ?? [],
        issuer: serverMetadata.issuer,
        authorizationEndpoint: serverMetadata.authorization_endpoint,
        tokenEndpoint: serverMetadata.token_endpoint,
        registrationEndpoint: serverMetadata.registration_endpoint ?? null,
        revocationEndpoint: 'revocation_endpoint' in serverMetadata ? (serverMetadata.revocation_endpoint ?? null) : null,
        codeChallengeMethods: serverMetadata.code_challenge_methods_supported ?? [],
        serverScopes: serverMetadata.scopes_supported ?? [],
      };
      return ok(discovered);
    },

    async register(registrationEndpoint, { clientName, redirectUri, scope }) {
      let response: Response;
      try {
        response = await timedFetch(registrationEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          // A confidential client (RFC 9700 2.2.2): its refresh tokens are bound to its secret.
          body: JSON.stringify({
            client_name: clientName,
            redirect_uris: [redirectUri],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'client_secret_post',
            scope,
          }),
        });
      } catch (error) {
        return err({ reason: reasonOf(error) });
      }
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        const refusal = registrationErrorSchema.safeParse(body);
        return err({ reason: refusal.success ? [refusal.data.error, refusal.data.error_description].filter((part) => part !== undefined).join(': ') : `HTTP ${String(response.status)}` });
      }
      const registered = registeredSchema.safeParse(body);
      if (!registered.success) {
        return err({ reason: 'the registration answered no client id' });
      }
      const { client_id: clientId, client_secret: clientSecret, registration_client_uri: registrationClientUri, registration_access_token: registrationAccessToken } = registered.data;
      return ok({ clientId, clientSecret: clientSecret ?? null, registrationClientUri: registrationClientUri ?? null, registrationAccessToken: registrationAccessToken ?? null });
    },
  };
}
