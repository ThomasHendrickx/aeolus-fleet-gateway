/**
 * The gateway's OAuth 2.1 authorization server over HTTP, for outside MCP
 * clients (MCP 2026-07-28 authorization): the metadata of RFC 9728 and RFC
 * 8414; /authorize, where a person picks what the client acts as (Q1 a) and
 * is sent to pagasae to sign in; /pagasae/callback, where pagasae sends them
 * back; the waiting address, where a client asked for waits for an approver
 * (decision 0056); and /token. What a person reads is the web app's (header
 * design H3): a door sends the browser to its page, the pick page, the
 * waiting page or the page saying why it got nowhere. Each route parses the
 * request and calls one use case. Only a signed-in account asks for a client,
 * so a gateway where no pagasae is set answers no client (Thomas's question A).
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { ExchangeToken } from '../../core/oauth/exchange-token.js';
import type { AuthorizationRefusal, ReadAuthorization } from '../../core/oauth/read-authorization.js';
import { REQUEST_LIFETIME_MS } from '../../core/requests/open-request.js';
import type { ReadWaiting } from '../../core/requests/read-waiting.js';
import type { WatchWaiting } from '../../core/requests/watch-waiting.js';
import type { Clock } from '../../core/shared/clock.js';
import type { CompleteSignIn, SignInAnswer } from '../../core/sign-in/complete-sign-in.js';
import { SIGN_IN_LIFETIME_MS, type StartSignIn } from '../../core/sign-in/start-sign-in.js';
import { acceptForms, isSameOrigin } from './forms.js';
import { acceptWebsockets, type ChangeHub } from './live.js';

const HTTP_FOUND = 302;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const MS_PER_SECOND = 1000;

/** Why the waiting page's live channel was closed: it does not open again. */
const CLOSE_OTHER_ORIGIN = 4403;

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
  /** Signing people in through pagasae (decision 0054) and their clients' waits, followed live; unset where no pagasae is set. */
  signIn?: { start: StartSignIn; complete: CompleteSignIn; readWaiting: ReadWaiting; watchWaiting: WatchWaiting; hub: ChangeHub; clock: Clock };
}

function fieldsOf(value: unknown): Record<string, string> {
  const fields = fieldsSchema.safeParse(value);
  return fields.success ? fields.data : {};
}

function authorizationRequestOf(fields: Record<string, string>): Record<string, string | undefined> {
  return Object.fromEntries(AUTHORIZATION_PARAMETERS.map((name) => [name, fields[name]]));
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

/** The web app's waiting page, under the waiting cookie's path, so the browser sends the page its secret. */
const WAITING_PAGE = `${WAITING_COOKIE.path}/approval`;

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

/**
 * Why a browser got nowhere, as the web app's page at /authorize/failed
 * says it: the client is unknown; no pick was made; the sign-in is unknown
 * or ended, or another browser's; the fleet is not served, or its outside
 * parties are off; pagasae refused; the wait is unknown, or another
 * browser's; or this gateway signs no one in.
 */
export type FailedReason =
  | 'invalidClient'
  | 'noPick'
  | 'unknownSignIn'
  | 'otherBrowser'
  | 'fleetNotServed'
  | 'outsidePartiesOff'
  | 'pagasaeRefused'
  | 'unknownWaiting'
  | 'otherBrowserWaiting'
  | 'noSignIn';

/** The web app's pages the doors send a browser to. */
const PICK_PAGE = '/authorize/pick';
const FAILED_PAGE = '/authorize/failed';

/** Sends the browser to the web app's page saying why it got nowhere. */
function failed(reply: FastifyReply, reason: FailedReason): FastifyReply {
  return reply.code(HTTP_FOUND).header('location', `${FAILED_PAGE}?${new URLSearchParams({ reason }).toString()}`).send();
}

function sendBack(reply: FastifyReply, answer: { refusal: AuthorizationRefusal; issuer: string }): FastifyReply {
  const { refusal, issuer } = answer;
  if (refusal.kind === 'invalidClient') {
    return failed(reply, 'invalidClient');
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
      return failed(reply, 'noPick');
    }
    const started = await signIn.start({ request: authorizationRequestOf(fields), holder: holder.data });
    if (!started.isOk) {
      return sendBack(reply, { refusal: started.error, issuer });
    }
    const cookie = cookieHeader(SIGN_IN_COOKIE, { value: started.value.browserSecret, maxAgeSeconds: SIGN_IN_LIFETIME_MS / MS_PER_SECOND, isSecure });
    return reply.code(HTTP_FOUND).header('location', started.value.redirectTo).header('set-cookie', cookie).send();
  });

  /** Where the browser goes next: back to the client, or, holding the secret in its waiting cookie, to the waiting page. */
  const goOn = (reply: FastifyReply, { answer, browserSecret }: { answer: SignInAnswer; browserSecret: string | undefined }): FastifyReply => {
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
    switch (refusal.kind) {
      case 'invalidClient':
      case 'redirect':
        return sendBack(reply, { refusal, issuer });
      case 'pagasaeRefused':
        request.log.warn({ reason: refusal.message }, 'pagasae did not take the sign-in code');
        return failed(reply, refusal.kind);
      case 'unknownSignIn':
      case 'otherBrowser':
      case 'fleetNotServed':
      case 'outsidePartiesOff':
        return failed(reply, refusal.kind);
    }
  });

  // The sealed waiting goes in the query, as it is longer than a path parameter may be.
  server.get(WAITING_COOKIE.path, async (request, reply) => {
    const { waiting = '' } = fieldsOf(request.query);
    const read = await signIn.readWaiting({ waiting, browserSecret: cookieValue(WAITING_COOKIE, request.headers.cookie) });
    if (read.isOk) {
      if (read.value.kind === 'waiting') {
        return reply.code(HTTP_FOUND).header('location', `${WAITING_PAGE}?${new URLSearchParams({ waiting }).toString()}`).send();
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
        return failed(reply, 'unknownWaiting');
      case 'otherBrowser':
        return failed(reply, 'otherBrowserWaiting');
    }
  });

  // The waiting page's live channel: told when its request expires, and to go on once the request no longer waits.
  acceptWebsockets(server, () => {
    server.get(`${WAITING_COOKIE.path}/live`, { websocket: true }, async (socket, request) => {
      if (!isSameOrigin(request)) {
        socket.close(CLOSE_OTHER_ORIGIN, 'Opened only from the waiting page');
        return;
      }
      const opened = { waiting: fieldsOf(request.query).waiting ?? '', browserSecret: cookieValue(WAITING_COOKIE, request.headers.cookie) };
      const watched = await signIn.watchWaiting(opened);
      // Whatever does not wait, refused or decided, the page's own address says.
      if (!watched.isOk || !watched.value.isWaiting) {
        socket.send(JSON.stringify({ go: true }));
        return;
      }
      socket.send(JSON.stringify({ expiresAt: watched.value.expiresAt.toISOString() }));
      const unsubscribe = signIn.hub.subscribe({
        fleetId: watched.value.fleetId,
        read: () => {
          void signIn.watchWaiting(opened).then((again) => {
            if (!again.isOk || !again.value.isWaiting) {
              socket.send(JSON.stringify({ go: true }));
              unsubscribe();
            }
          });
        },
      });
      socket.on('close', unsubscribe);
    });
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
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  }));

  server.get('/authorize', async (request, reply) => {
    if (deps.signIn === undefined) {
      return failed(reply, 'noSignIn');
    }
    const parameters = authorizationRequestOf(fieldsOf(request.query));
    const read = await deps.readAuthorization(parameters);
    if (!read.isOk) {
      return sendBack(reply, { refusal: read.error, issuer: deps.issuer });
    }
    const asked = Object.entries(parameters).flatMap(([name, value]) => (value === undefined ? [] : [[name, value]]));
    return reply.code(HTTP_FOUND).header('location', `${PICK_PAGE}?${new URLSearchParams(asked).toString()}`).send();
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
    return { access_token: accessToken, token_type: 'Bearer', expires_in: expiresInSeconds, ...(refreshToken === null ? {} : { refresh_token: refreshToken }), ...(scope === null ? {} : { scope }) };
  });
}
