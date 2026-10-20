/**
 * The gateway's OAuth 2.1 authorization server over HTTP, for outside MCP
 * clients (MCP 2026-07-28 authorization): the metadata of RFC 9728 and RFC
 * 8414; /authorize, where a person picks what the client acts as (Q1 a) and
 * is sent to pagasae to sign in; /pagasae/callback, where pagasae sends them
 * back; the waiting page, where a client asked for waits for an approver
 * (decision 0056); and /token. Each route parses the request and calls one
 * use case. Only a signed-in account asks for a client, so a gateway where
 * no pagasae is set answers no client (Thomas's question A).
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { ExchangeToken } from '../../core/oauth/exchange-token.js';
import type { AuthorizationRefusal, AuthorizationRequest, ReadAuthorization } from '../../core/oauth/read-authorization.js';
import type { ClientAnswer } from '../../core/requests/ask-for-client.js';
import { REQUEST_LIFETIME_MS } from '../../core/requests/open-request.js';
import type { ReadWaiting } from '../../core/requests/read-waiting.js';
import type { CompleteSignIn } from '../../core/sign-in/complete-sign-in.js';
import { SIGN_IN_LIFETIME_MS, type StartSignIn } from '../../core/sign-in/start-sign-in.js';
import { acceptForms, documentOf, escaped } from './html.js';

const HTTP_FOUND = 302;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_BAD_GATEWAY = 502;
const MS_PER_SECOND = 1000;

/** How often the waiting page looks again. */
const WAITING_RELOAD_SECONDS = 5;

/** Whether the gateway is served over HTTPS, so its cookies go over HTTPS only. */
const isHttps = (issuer: string) => new URL(issuer).protocol === 'https:';

/** The parameters of an authorization request the page carries from its query to its form. */
const AUTHORIZATION_PARAMETERS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'resource', 'state', 'scope'] as const;

const fieldsSchema = z.record(z.string(), z.unknown()).transform((fields) =>
  Object.fromEntries(Object.entries(fields).flatMap(([name, value]) => (typeof value === 'string' ? [[name, value]] : []))),
);

/** What the person may pick the client to act as. */
const holderSchema = z.enum(['account', 'party']);

export interface OAuthRoutesDeps {
  issuer: string;
  resource: string;
  readAuthorization: ReadAuthorization;
  exchangeToken: ExchangeToken;
  /** Signing people in through pagasae (decision 0054) and their clients' waits; unset where no pagasae is set. */
  signIn?: { start: StartSignIn; complete: CompleteSignIn; readWaiting: ReadWaiting };
}

function fieldsOf(value: unknown): Record<string, string> {
  const fields = fieldsSchema.safeParse(value);
  return fields.success ? fields.data : {};
}

function authorizationRequestOf(fields: Record<string, string>): Record<string, string | undefined> {
  return Object.fromEntries(AUTHORIZATION_PARAMETERS.map((name) => [name, fields[name]]));
}

/** A page of the gateway, never cached. */
function htmlPage(reply: FastifyReply, page: { status: number; title: string; body: string; head?: string }): FastifyReply {
  return reply.code(page.status).type('text/html; charset=utf-8').header('cache-control', 'no-store').send(documentOf({ title: page.title, head: page.head ?? '', body: page.body }));
}

/** A page that tells a person why their client got nothing, sending them nowhere. */
function errorPage(reply: FastifyReply, page: { status: number; title: string; message: string }): FastifyReply {
  return htmlPage(reply, { status: page.status, title: page.title, body: `<h1>${escaped(page.title)}</h1><p class="error">${escaped(page.message)}</p>` });
}

/** A browser cookie the gateway keeps a secret in for one path, or clears. Lax, so it comes back on a redirect from pagasae. */
interface BrowserCookie {
  name: string;
  path: string;
}

/** The cookie the browser that started a sign-in holds its secret in, sent back to the callback only. */
const SIGN_IN_COOKIE: BrowserCookie = { name: 'aeolus_sign_in', path: '/pagasae/callback' };

/** The cookie the browser that asked for a client holds the same secret in, sent back to the waiting page only. */
const WAITING_COOKIE: BrowserCookie = { name: 'aeolus_waiting', path: '/authorize/waiting' };

function cookieHeader(cookie: BrowserCookie, set: { value: string; maxAgeSeconds: number; isSecure: boolean }): string {
  return `${cookie.name}=${set.value}; Path=${cookie.path}; Max-Age=${String(set.maxAgeSeconds)}; HttpOnly;${set.isSecure ? ' Secure;' : ''} SameSite=Lax`;
}

/** The cookie's value from a Cookie header, if the browser sent it. */
function cookieValue(cookie: BrowserCookie, header: string | undefined): string | undefined {
  const prefix = `${cookie.name}=`;
  return header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

function sendBack(reply: FastifyReply, answer: { refusal: AuthorizationRefusal; issuer: string }): FastifyReply {
  const { refusal, issuer } = answer;
  if (refusal.kind === 'invalidClient') {
    return errorPage(reply, { status: HTTP_BAD_REQUEST, title: 'Connect an MCP client', message: refusal.message });
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

/** The page at /authorize: the client, and the two picks (Q1 a), each starting a sign-in through pagasae. */
function pickPage(request: Record<string, string | undefined>, authorization: AuthorizationRequest): string {
  const hidden = Object.entries(request)
    .flatMap(([name, value]) => (value === undefined ? [] : [`<input type="hidden" name="${escaped(name)}" value="${escaped(value)}">`]))
    .join('');
  return `<h1>Connect an MCP client</h1>
<p><strong>${escaped(authorization.clientName)}</strong> asks to call your fleet's ships through the gateway.</p>
<p class="muted">Client ${escaped(authorization.clientId)}, sent back to ${escaped(authorization.redirectUri)}.</p>
<form method="get" action="/authorize/sign-in">${hidden}
<p><button name="holder" value="account">Sign in as yourself</button> <span class="muted">The client acts as you.</span></p>
<p><button name="holder" value="party">Ask for access for this client</button> <span class="muted">An approver of your fleet decides; the client then acts as its own party.</span></p>
</form>`;
}

/** The waiting page: the client waits for approval, and the page looks again by itself. */
function waitingPage(clientName: string): string {
  return `<h1>Waiting for approval</h1>
<p><strong>${escaped(clientName)}</strong> waits for an approver of your fleet. This page goes on by itself once it is decided; you may close it and connect again later.</p>`;
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

/** Signing people in through pagasae, and the waiting page (decisions 0054, 0056). */
function registerSignIn(server: FastifyInstance, deps: { issuer: string; signIn: NonNullable<OAuthRoutesDeps['signIn']> }): void {
  const { issuer, signIn } = deps;
  const isSecure = isHttps(issuer);

  server.get('/authorize/sign-in', async (request, reply) => {
    const fields = fieldsOf(request.query);
    const holder = holderSchema.safeParse(fields.holder);
    if (!holder.success) {
      return errorPage(reply, { status: HTTP_BAD_REQUEST, title: 'Connect an MCP client', message: 'Pick on the page whether to sign in as yourself or to ask for access for the client.' });
    }
    const started = await signIn.start({ request: authorizationRequestOf(fields), holder: holder.data });
    if (!started.isOk) {
      return sendBack(reply, { refusal: started.error, issuer });
    }
    const cookie = cookieHeader(SIGN_IN_COOKIE, { value: started.value.browserSecret, maxAgeSeconds: SIGN_IN_LIFETIME_MS / MS_PER_SECOND, isSecure });
    return reply.code(HTTP_FOUND).header('location', started.value.redirectTo).header('set-cookie', cookie).send();
  });

  /** Where the browser goes next: back to the client, or, holding the secret in its waiting cookie, to the waiting page. */
  const goOn = (reply: FastifyReply, { answer, browserSecret }: { answer: ClientAnswer; browserSecret: string | undefined }): FastifyReply => {
    const cleared = cookieHeader(SIGN_IN_COOKIE, { value: '', maxAgeSeconds: 0, isSecure });
    if (answer.kind === 'answered') {
      return reply.code(HTTP_FOUND).header('location', answer.redirectTo).header('set-cookie', cleared).send();
    }
    const waiting = cookieHeader(WAITING_COOKIE, { value: browserSecret ?? '', maxAgeSeconds: REQUEST_LIFETIME_MS / MS_PER_SECOND, isSecure });
    return reply.code(HTTP_FOUND).header('location', `${WAITING_COOKIE.path}?${new URLSearchParams({ waiting: answer.waiting }).toString()}`).header('set-cookie', [cleared, waiting]).send();
  };

  server.get(SIGN_IN_COOKIE.path, async (request, reply) => {
    const { state, code, error } = fieldsOf(request.query);
    const browserSecret = cookieValue(SIGN_IN_COOKIE, request.headers.cookie);
    const completed = await signIn.complete({ state, code, error, browserSecret });
    if (completed.isOk) {
      return goOn(reply, { answer: completed.value, browserSecret });
    }
    void reply.header('set-cookie', cookieHeader(SIGN_IN_COOKIE, { value: '', maxAgeSeconds: 0, isSecure }));
    const refusal = completed.error;
    const title = 'Sign in';
    switch (refusal.kind) {
      case 'invalidClient':
      case 'redirect':
        return sendBack(reply, { refusal, issuer });
      case 'unknownSignIn':
        return errorPage(reply, { status: HTTP_BAD_REQUEST, title, message: 'This sign-in is unknown, or took over 10 minutes. Start again from your MCP client.' });
      case 'otherBrowser':
        return errorPage(reply, { status: HTTP_BAD_REQUEST, title, message: 'This sign-in was started in another browser, so it is not yours to finish. Start again from your MCP client.' });
      case 'fleetNotServed':
        return errorPage(reply, { status: HTTP_FORBIDDEN, title, message: 'This gateway does not serve the fleet you signed in to.' });
      case 'outsidePartiesOff':
        return errorPage(reply, { status: HTTP_FORBIDDEN, title, message: "Your fleet's outside parties are off, so no MCP client can ask for access. Sign in as yourself instead, or ask whoever runs your fleet." });
      case 'pagasaeRefused':
        return errorPage(reply, { status: HTTP_BAD_GATEWAY, title, message: `The sign-in did not go through: ${refusal.message}. Start again from your MCP client.` });
    }
  });

  // The sealed waiting goes in the query, as it is longer than a path parameter may be.
  server.get(WAITING_COOKIE.path, async (request, reply) => {
    const { waiting = '' } = fieldsOf(request.query);
    const read = await signIn.readWaiting({ waiting, browserSecret: cookieValue(WAITING_COOKIE, request.headers.cookie) });
    const title = 'Waiting for approval';
    if (read.isOk) {
      if (read.value.kind === 'waiting') {
        return htmlPage(reply, { status: 200, title, body: waitingPage(read.value.clientName), head: `<meta http-equiv="refresh" content="${String(WAITING_RELOAD_SECONDS)}">` });
      }
      const cleared = cookieHeader(WAITING_COOKIE, { value: '', maxAgeSeconds: 0, isSecure });
      return reply.code(HTTP_FOUND).header('location', read.value.redirectTo).header('set-cookie', cleared).send();
    }
    const refusal = read.error;
    switch (refusal.kind) {
      case 'invalidClient':
      case 'redirect':
        return sendBack(reply, { refusal, issuer });
      case 'unknownWaiting':
        return errorPage(reply, { status: HTTP_NOT_FOUND, title, message: 'This request is unknown, or ended long ago. Start again from your MCP client.' });
      case 'otherBrowser':
        return errorPage(reply, { status: HTTP_BAD_REQUEST, title, message: 'This request was made in another browser, so it is not yours to follow. Start again from your MCP client.' });
    }
  });
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

  server.get('/authorize', async (request, reply) => {
    if (deps.signIn === undefined) {
      return errorPage(reply, { status: HTTP_FORBIDDEN, title: 'Connect an MCP client', message: 'This gateway signs no one in, so no MCP client can connect to it: its operator sets pagasae first.' });
    }
    const parameters = authorizationRequestOf(fieldsOf(request.query));
    const read = await deps.readAuthorization(parameters);
    if (!read.isOk) {
      return sendBack(reply, { refusal: read.error, issuer: deps.issuer });
    }
    return htmlPage(reply, { status: 200, title: 'Connect an MCP client', body: pickPage(parameters, read.value) });
  });

  if (deps.signIn !== undefined) {
    registerSignIn(server, { issuer: deps.issuer, signIn: deps.signIn });
  }

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
