import type { FleetId } from '@aeolus-fleet/common';
import { z } from 'zod';

import { err, ok, type Result } from '../shared/result.js';
import type { ClientMetadataDocuments, FleetEndpoints, OAuthClients, OAuthErrorCode } from './ports.js';
import { isLoopback, isRedirectUri } from './redirect-uri.js';

/** An authorization request the gateway read and found valid, for argo to approve or deny. */
export interface AuthorizationRequest {
  readonly clientId: string;
  readonly clientName: string;
  /** The fleet a pre-registered client belongs to; null for a client known by its metadata document. */
  readonly clientFleetId: FleetId | null;
  /** The fleet whose MCP endpoint the request asks a token for. */
  readonly fleetId: FleetId;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly resource: string;
  readonly scope: string | null;
  readonly state: string | null;
}

/**
 * Why a request is refused:
 * - invalidClient: the client or its redirect URI is not known, so the page says so and sends nobody anywhere (RFC 6749, 4.1.2.1);
 * - redirect: the client is known, so it is sent back to its redirect URI with the error.
 */
export type AuthorizationRefusal =
  | { readonly kind: 'invalidClient'; readonly message: string }
  | { readonly kind: 'redirect'; readonly redirectUri: string; readonly error: OAuthErrorCode; readonly description: string; readonly state: string | null };

export type ReadAuthorization = (request: Readonly<Record<string, string | undefined>>) => Promise<Result<AuthorizationRequest, AuthorizationRefusal>>;

/** A client's metadata document (CIMD), as far as the gateway reads it. */
const metadataDocumentSchema = z.object({
  client_id: z.string(),
  client_name: z.string().min(1).optional(),
  redirect_uris: z.array(z.string()).min(1),
});

/** A client id that is a metadata document's URL: https, or http on this machine, with a path. */
function metadataDocumentUrl(clientId: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return undefined;
  }
  const isSecure = url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url));
  return isSecure && url.pathname !== '/' && url.hash === '' ? url : undefined;
}

interface KnownClient {
  name: string;
  fleetId: FleetId | null;
  redirectUris: readonly string[];
}

/**
 * Use case: the gateway reads an authorization request from an MCP client
 * (OAuth 2.1 with PKCE, MCP 2026-07-28). The client is pre-registered, or
 * known by its metadata document (CIMD), fetched from its client id. Only
 * the S256 challenge is taken, and the resource must be a fleet's MCP
 * endpoint (RFC 8707), so a token is bound to it; a pre-registered client
 * asks only for its own fleet's.
 */
export function createReadAuthorization(deps: { clients: OAuthClients; documents: ClientMetadataDocuments; endpoints: FleetEndpoints }): ReadAuthorization {
  const knownClient = async (clientId: string): Promise<Result<KnownClient, string>> => {
    const url = metadataDocumentUrl(clientId);
    if (url === undefined) {
      const client = await deps.clients.find(clientId);
      return client ? ok({ name: client.name, fleetId: client.fleetId, redirectUris: client.redirectUris }) : err(`No client ${clientId} is registered`);
    }
    const fetched = await deps.documents.fetch(url.toString());
    if (!fetched.isOk) {
      return err(`The client's metadata document at ${clientId} could not be read: ${fetched.error.reason}`);
    }
    const document = metadataDocumentSchema.safeParse(fetched.value);
    if (!document.success || document.data.client_id !== clientId || !document.data.redirect_uris.every(isRedirectUri)) {
      return err(`The client's metadata document at ${clientId} does not name it, or names no valid redirect URI`);
    }
    return ok({ name: document.data.client_name ?? url.hostname, fleetId: null, redirectUris: document.data.redirect_uris });
  };

  return async (request) => {
    const clientId = request.client_id;
    if (clientId === undefined || clientId === '') {
      return err({ kind: 'invalidClient', message: 'The request names no client' });
    }
    const client = await knownClient(clientId);
    if (!client.isOk) {
      return err({ kind: 'invalidClient', message: client.error });
    }
    const redirectUri = request.redirect_uri;
    if (redirectUri === undefined || !client.value.redirectUris.includes(redirectUri)) {
      return err({ kind: 'invalidClient', message: `${client.value.name} registered no such redirect URI` });
    }
    const state = request.state ?? null;
    const sendBack = (error: OAuthErrorCode, description: string) => err({ kind: 'redirect' as const, redirectUri, error, description, state });
    if (request.response_type !== 'code') {
      return sendBack('unsupported_response_type', 'Only the authorization code flow is served');
    }
    const codeChallenge = request.code_challenge;
    if (codeChallenge === undefined || codeChallenge === '' || request.code_challenge_method !== 'S256') {
      return sendBack('invalid_request', 'A PKCE code challenge with the S256 method is required');
    }
    const resource = request.resource;
    const fleetId = resource === undefined ? undefined : await deps.endpoints.fleetOf(resource);
    if (resource === undefined || fleetId === undefined) {
      return sendBack('invalid_target', "The resource must be a fleet's MCP endpoint at this gateway");
    }
    if (client.value.fleetId !== null && client.value.fleetId !== fleetId) {
      return err({ kind: 'invalidClient', message: `${client.value.name} is registered for another fleet` });
    }
    return ok({ clientId, clientName: client.value.name, clientFleetId: client.value.fleetId, fleetId, redirectUri, codeChallenge, resource, scope: request.scope ?? null, state });
  };
}
