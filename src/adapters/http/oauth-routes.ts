/**
 * The gateway's OAuth 2.1 authorization server over HTTP, for outside MCP
 * clients (MCP 2026-07-28 authorization): the metadata of RFC 9728 and RFC
 * 8414, /authorize, where argo approves each client signed in to the
 * console, and /token. Each route parses the request and calls one use case.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { idSchema, type FleetId } from '@aeolus-fleet/common';

import type { ApprovalRefusal, ApproveAuthorization } from '../../core/oauth/approve-authorization.js';
import type { ExchangeToken } from '../../core/oauth/exchange-token.js';
import type { AuthorizationRefusal, AuthorizationRequest, ReadAuthorization } from '../../core/oauth/read-authorization.js';
import type { AuthenticateOperator } from '../../core/operator/authenticate-operator.js';
import type { ReadClientParty } from '../../core/parties/read-client-party.js';
import type { ShownParty } from '../../core/parties/shown-party.js';
import { acceptForms, escaped, isSameOrigin, layout } from './html.js';
import { randomUUID } from 'node:crypto';

const HTTP_FOUND = 302;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_CONFLICT = 409;

/** The parameters of an authorization request the page carries from its query to its form. */
const AUTHORIZATION_PARAMETERS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'resource', 'state', 'scope'] as const;

const fieldsSchema = z.record(z.string(), z.unknown()).transform((fields) =>
  Object.fromEntries(Object.entries(fields).flatMap(([name, value]) => (typeof value === 'string' ? [[name, value]] : []))),
);

export interface OAuthRoutesDeps {
  issuer: string;
  resource: string;
  fleetUrl: string;
  authenticateOperator: AuthenticateOperator;
  readAuthorization: ReadAuthorization;
  approveAuthorization: ApproveAuthorization;
  exchangeToken: ExchangeToken;
  readClientParty: ReadClientParty;
}

function fieldsOf(value: unknown): Record<string, string> {
  const fields = fieldsSchema.safeParse(value);
  return fields.success ? fields.data : {};
}

function authorizationRequestOf(fields: Record<string, string>): Record<string, string | undefined> {
  return Object.fromEntries(AUTHORIZATION_PARAMETERS.map((name) => [name, fields[name]]));
}

function htmlPage(reply: FastifyReply, page: { status: number; body: string }): FastifyReply {
  return reply.code(page.status).type('text/html; charset=utf-8').header('cache-control', 'no-store').send(layout('Approve an MCP client', page.body));
}

function sendBack(reply: FastifyReply, answer: { refusal: AuthorizationRefusal; issuer: string }): FastifyReply {
  const { refusal, issuer } = answer;
  if (refusal.kind === 'invalidClient') {
    return htmlPage(reply, { status: HTTP_BAD_REQUEST, body: `<h1>Approve an MCP client</h1><p class="error">${escaped(refusal.message)}</p>` });
  }
  const url = new URL(refusal.redirectUri);
  url.searchParams.append('error', refusal.error);
  url.searchParams.append('error_description', refusal.description);
  if (refusal.state !== null) {
    url.searchParams.append('state', refusal.state);
  }
  url.searchParams.append('iss', issuer);
  return reply.code(HTTP_FOUND).header('location', url.toString()).send();
}

/** What the page shows and asks: the client, and its party, or the fields to name one at its first approval. */
interface ApprovalPage {
  request: Record<string, string | undefined>;
  authorization: AuthorizationRequest;
  party: ShownParty | undefined;
  error?: string;
}

function approvalForm({ request, authorization, party, error }: ApprovalPage): string {
  const hidden = Object.entries(request)
    .flatMap(([name, value]) => (value === undefined ? [] : [`<input type="hidden" name="${escaped(name)}" value="${escaped(value)}">`]))
    .join('');
  const asParty =
    party === undefined
      ? `<p>It is no party of your fleet yet. Name its proxy ship, the ship it calls the fleet as, and the owner who answers for it.</p>
<input type="hidden" name="partyRequestId" value="${randomUUID()}">
<label>Name, the proxy ship's<input name="partyName" required></label>
<label>Owner's ship id (a person's ship, or argo)<input name="ownerShipId" required></label>`
      : `<p>It calls the fleet as the party <strong>${escaped(party.name)}</strong>.</p>`;
  return `<h1>Approve an MCP client</h1>
${error === undefined ? '' : `<p class="error">${escaped(error)}</p>`}
<p><strong>${escaped(authorization.clientName)}</strong> asks to call your fleet's ships through the gateway.</p>
<p class="muted">Client ${escaped(authorization.clientId)}, sent back to ${escaped(authorization.redirectUri)}.</p>
<form method="post" action="/authorize">${hidden}${asParty}<div class="inline"><button name="decision" value="approve">Approve</button> <button name="decision" value="deny" formnovalidate>Deny</button></div></form>`;
}

/** Client credentials in an HTTP Basic header (RFC 6749, 2.3.1): each part form-urlencoded. */
function basicCredentials(header: string | undefined): Record<string, string> {
  if (header?.startsWith('Basic ') !== true) {
    return {};
  }
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) {
    return {};
  }
  const decode = (part: string) => decodeURIComponent(part.replaceAll('+', ' '));
  return { client_id: decode(decoded.slice(0, separator)), client_secret: decode(decoded.slice(separator + 1)) };
}

export function registerOAuthRoutes(server: FastifyInstance, deps: OAuthRoutesDeps): void {
  acceptForms(server);

  const protectedResource = { resource: deps.resource, authorization_servers: [deps.issuer], bearer_methods_supported: ['header'] };
  server.get('/.well-known/oauth-protected-resource', () => protectedResource);
  server.get(`/.well-known/oauth-protected-resource${new URL(deps.resource).pathname}`, () => protectedResource);
  server.get('/.well-known/oauth-authorization-server', () => ({
    issuer: deps.issuer,
    authorization_endpoint: `${deps.issuer}/authorize`,
    token_endpoint: `${deps.issuer}/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  }));

  /** argo's fleet, when the request comes from argo signed in to the console; else the page that says why not. */
  const argoOrRefusal = async (request: FastifyRequest, reply: FastifyReply) => {
    const operator = await deps.authenticateOperator(request.headers.cookie);
    if (!operator.isOk) {
      return {
        refused: htmlPage(reply, {
          status: HTTP_UNAUTHORIZED,
          body: `<h1>Approve an MCP client</h1><p class="error">${escaped(operator.error.message)}</p><p><a href="${escaped(deps.fleetUrl)}">Sign in to the console of your fleet</a>, then reload this page.</p>`,
        }),
      };
    }
    if (!operator.value.scopes.includes('fleet:manage')) {
      return { refused: htmlPage(reply, { status: HTTP_FORBIDDEN, body: '<h1>Approve an MCP client</h1><p class="error">Only argo approves MCP clients: a viewer session only reads.</p>' }) };
    }
    return { fleetId: operator.value.fleetId };
  };

  server.get('/authorize', async (request, reply) => {
    const argo = await argoOrRefusal(request, reply);
    if ('refused' in argo) {
      return argo.refused;
    }
    const parameters = authorizationRequestOf(fieldsOf(request.query));
    const read = await deps.readAuthorization(parameters);
    if (!read.isOk) {
      return sendBack(reply, { refusal: read.error, issuer: deps.issuer });
    }
    const party = await deps.readClientParty({ fleetId: argo.fleetId, clientId: read.value.clientId });
    return htmlPage(reply, { status: 200, body: approvalForm({ request: parameters, authorization: read.value, party }) });
  });

  server.post('/authorize', async (request, reply) => {
    if (!isSameOrigin(request)) {
      return reply.code(HTTP_FORBIDDEN).type('text/plain; charset=utf-8').send('An approval is sent only from the gateway\'s page.');
    }
    const argo = await argoOrRefusal(request, reply);
    if ('refused' in argo) {
      return argo.refused;
    }
    const fields = fieldsOf(request.body);
    const parameters = authorizationRequestOf(fields);
    const owner = idSchema('ship').safeParse(fields.ownerShipId);
    const newParty = fields.partyName === undefined || fields.partyRequestId === undefined || !owner.success ? undefined : { requestId: fields.partyRequestId, name: fields.partyName, ownerShipId: owner.data };
    const decided = await deps.approveAuthorization({ fleetId: argo.fleetId, request: parameters, isApproved: fields.decision === 'approve', ...(newParty === undefined ? {} : { newParty }) });
    if (!decided.isOk) {
      return refusedApproval(reply, { refusal: decided.error, request: parameters, fleetId: argo.fleetId });
    }
    return reply.code(HTTP_FOUND).header('location', decided.value.redirectTo).send();
  });

  /** A refused approval: back to the client, or the page again with what argo must fix. */
  const refusedApproval = async (reply: FastifyReply, refused: { refusal: ApprovalRefusal; request: Record<string, string | undefined>; fleetId: FleetId }): Promise<FastifyReply> => {
    const { refusal } = refused;
    if (refusal.kind === 'invalidClient' || refusal.kind === 'redirect') {
      return sendBack(reply, { refusal, issuer: deps.issuer });
    }
    const read = await deps.readAuthorization(refused.request);
    if (!read.isOk) {
      return sendBack(reply, { refusal: read.error, issuer: deps.issuer });
    }
    const party = await deps.readClientParty({ fleetId: refused.fleetId, clientId: read.value.clientId });
    const error = refusal.kind === 'needsParty' ? "Name the client's party and its owner (a ship id, shp_...)" : refusal.message;
    return htmlPage(reply, { status: refusal.kind === 'needsParty' ? HTTP_BAD_REQUEST : HTTP_CONFLICT, body: approvalForm({ request: refused.request, authorization: read.value, party, error }) });
  };

  server.post('/token', async (request, reply) => {
    const exchanged = await deps.exchangeToken({ ...fieldsOf(request.body), ...basicCredentials(request.headers.authorization) });
    void reply.header('cache-control', 'no-store').header('pragma', 'no-cache');
    if (!exchanged.isOk) {
      const status = exchanged.error.error === 'invalid_client' ? HTTP_UNAUTHORIZED : HTTP_BAD_REQUEST;
      return reply.code(status).send({ error: exchanged.error.error, error_description: exchanged.error.description });
    }
    const { accessToken, refreshToken, expiresInSeconds, scope } = exchanged.value;
    return { access_token: accessToken, token_type: 'Bearer', expires_in: expiresInSeconds, refresh_token: refreshToken, ...(scope === null ? {} : { scope }) };
  });
}
