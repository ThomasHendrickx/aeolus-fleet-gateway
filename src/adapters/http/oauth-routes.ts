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
import type { AuthorizePerson } from '../../core/federation/authorize-person.js';
import type { CompleteSignIn } from '../../core/federation/complete-sign-in.js';
import type { ReadIdentityProvider } from '../../core/federation/read-identity-provider.js';
import type { StartSignIn } from '../../core/federation/start-sign-in.js';
import type { ExchangeToken } from '../../core/oauth/exchange-token.js';
import type { FleetEndpoints } from '../../core/oauth/ports.js';
import type { AuthorizationRefusal, AuthorizationRequest, ReadAuthorization } from '../../core/oauth/read-authorization.js';
import type { AuthenticateOperator } from '../../core/operator/authenticate-operator.js';
import type { ReadClientParty } from '../../core/parties/read-client-party.js';
import type { ShownParty } from '../../core/parties/shown-party.js';
import { FLEET_ENDPOINT_PATH } from '../crypto/fleet-endpoints.js';
import { acceptForms, escaped, isSameOrigin, layout } from './html.js';
import { randomUUID } from 'node:crypto';

const HTTP_FOUND = 302;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_BAD_GATEWAY = 502;

/** Where the fleet's identity provider sends a person back: the redirect URI argo registers there. */
export const SIGN_IN_CALLBACK_PATH = '/oidc/callback';

/** The parameters of an authorization request the page carries from its query to its form. */
const AUTHORIZATION_PARAMETERS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'resource', 'state', 'scope'] as const;

const fieldsSchema = z.record(z.string(), z.unknown()).transform((fields) =>
  Object.fromEntries(Object.entries(fields).flatMap(([name, value]) => (typeof value === 'string' ? [[name, value]] : []))),
);

export interface OAuthRoutesDeps {
  issuer: string;
  endpoints: FleetEndpoints;
  fleetUrl: string;
  authenticateOperator: AuthenticateOperator;
  readAuthorization: ReadAuthorization;
  approveAuthorization: ApproveAuthorization;
  exchangeToken: ExchangeToken;
  readClientParty: ReadClientParty;
  readIdentityProvider: ReadIdentityProvider;
  startSignIn: StartSignIn;
  completeSignIn: CompleteSignIn;
  authorizePerson: AuthorizePerson;
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

  // Each fleet's MCP endpoint names this server (RFC 9728), at the well-known path before the endpoint's own.
  const endpointPath = `${new URL(deps.issuer).pathname.replace(/\/$/, '')}${FLEET_ENDPOINT_PATH}`;
  server.get<{ Params: { alias: string } }>(`/.well-known/oauth-protected-resource${endpointPath}`, async (request, reply) => {
    const resource = `${deps.issuer}${FLEET_ENDPOINT_PATH.replace(':alias', request.params.alias)}`;
    if ((await deps.endpoints.fleetOf(resource)) === undefined) {
      return reply.code(HTTP_NOT_FOUND).send({ error: 'No fleet has this MCP endpoint' });
    }
    return { resource, authorization_servers: [deps.issuer], bearer_methods_supported: ['header'] };
  });
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

  /** The page that asks argo to sign in to the console first. */
  const consoleSignIn = (reply: FastifyReply, message: string) =>
    htmlPage(reply, {
      status: HTTP_UNAUTHORIZED,
      body: `<h1>Approve an MCP client</h1><p class="error">${escaped(message)}</p><p><a href="${escaped(deps.fleetUrl)}">Sign in to the console of your fleet</a>, then reload this page.</p>`,
    });

  /**
   * Who comes with no console session is a person (Q25): where the fleet of
   * the endpoint asked for has an identity provider, they are offered to sign
   * in there; argo is still pointed to the console.
   */
  const signInOffer = async (reply: FastifyReply, offer: { parameters: Record<string, string | undefined>; message: string }) => {
    const read = await deps.readAuthorization(offer.parameters);
    const provider = read.isOk ? await deps.readIdentityProvider(read.value.fleetId) : null;
    if (!read.isOk || provider === null) {
      return consoleSignIn(reply, offer.message);
    }
    const sent = Object.entries(offer.parameters).filter((entry): entry is [string, string] => entry[1] !== undefined);
    const link = `/authorize/sign-in?${new URLSearchParams(sent).toString()}`;
    return htmlPage(reply, {
      status: 200,
      body: `<h1>Sign in</h1><p>${escaped(read.value.clientName)} asks to work as your ship.</p><p><a href="${escaped(link)}">Sign in with ${escaped(new URL(provider.issuer).host)}</a></p><p class="muted">argo approves MCP clients of apps: <a href="${escaped(deps.fleetUrl)}">sign in to the console of your fleet</a>, then reload this page.</p>`,
    });
  };

  /** argo's fleet, when the request comes from argo signed in to the console; else the page that says why not. */
  const argoOrRefusal = async (request: FastifyRequest, reply: FastifyReply) => {
    const operator = await deps.authenticateOperator(request.headers.cookie);
    if (!operator.isOk) {
      return { refused: consoleSignIn(reply, operator.error.message) };
    }
    if (!operator.value.scopes.includes('fleet:manage')) {
      return { refused: htmlPage(reply, { status: HTTP_FORBIDDEN, body: '<h1>Approve an MCP client</h1><p class="error">Only argo approves MCP clients: a viewer session only reads.</p>' }) };
    }
    return { fleetId: operator.value.fleetId };
  };

  server.get('/authorize', async (request, reply) => {
    const parameters = authorizationRequestOf(fieldsOf(request.query));
    const operator = await deps.authenticateOperator(request.headers.cookie);
    if (!operator.isOk) {
      return signInOffer(reply, { parameters, message: operator.error.message });
    }
    const argo = await argoOrRefusal(request, reply);
    if ('refused' in argo) {
      return argo.refused;
    }
    const read = await deps.readAuthorization(parameters);
    if (!read.isOk) {
      return sendBack(reply, { refusal: read.error, issuer: deps.issuer });
    }
    const party = await deps.readClientParty({ fleetId: argo.fleetId, clientId: read.value.clientId });
    return htmlPage(reply, { status: 200, body: approvalForm({ request: parameters, authorization: read.value, party }) });
  });

  /** A person goes to the fleet's identity provider to sign in. */
  server.get('/authorize/sign-in', async (request, reply) => {
    const started = await deps.startSignIn(authorizationRequestOf(fieldsOf(request.query)));
    if (started.isOk) {
      return reply.code(HTTP_FOUND).header('location', started.value.redirectTo).send();
    }
    const refusal = started.error;
    switch (refusal.kind) {
      case 'invalidClient':
      case 'redirect':
        return sendBack(reply, { refusal, issuer: deps.issuer });
      case 'noIdentityProvider':
        return htmlPage(reply, { status: HTTP_CONFLICT, body: '<h1>Sign in</h1><p class="error">This fleet has no identity provider: people cannot sign in yet. Ask argo to set one.</p>' });
      case 'providerUnusable':
        return htmlPage(reply, { status: HTTP_BAD_GATEWAY, body: `<h1>Sign in</h1><p class="error">${escaped(refusal.message)}</p>` });
    }
  });

  /** The person comes back from the identity provider. */
  server.get(SIGN_IN_CALLBACK_PATH, async (request, reply) => {
    const { state, code, error } = fieldsOf(request.query);
    const completed = await deps.completeSignIn({ ...(state === undefined ? {} : { state }), ...(code === undefined ? {} : { code }), ...(error === undefined ? {} : { error }) });
    if (!completed.isOk) {
      return htmlPage(reply, { status: HTTP_BAD_REQUEST, body: `<h1>Sign in</h1><p class="error">${escaped(completed.error.message)}</p>` });
    }
    const { person } = completed.value;
    const authorized = await deps.authorizePerson(completed.value);
    if (authorized.isOk) {
      return reply.code(HTTP_FOUND).header('location', authorized.value.redirectTo).send();
    }
    const refusal = authorized.error;
    if (refusal.kind !== 'notMapped') {
      return sendBack(reply, { refusal, issuer: deps.issuer });
    }
    return htmlPage(reply, {
      status: HTTP_FORBIDDEN,
      body: `<h1>Sign in</h1><p>You signed in as ${escaped(person.email ?? person.subject)} at ${escaped(person.issuer)}.</p><p class="error">argo has not given you a ship of this fleet yet: ask argo, then connect your MCP client again.</p>`,
    });
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
