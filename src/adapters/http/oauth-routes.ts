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
import { REQUEST_LIFETIME_MS } from '../../core/requests/open-request.js';
import type { ReadWaiting } from '../../core/requests/read-waiting.js';
import type { WatchWaiting } from '../../core/requests/watch-waiting.js';
import type { Clock } from '../../core/shared/clock.js';
import type { CompleteSignIn, SignInAnswer } from '../../core/sign-in/complete-sign-in.js';
import { SIGN_IN_LIFETIME_MS, type StartSignIn } from '../../core/sign-in/start-sign-in.js';
import { acceptForms, escaped, isSameOrigin } from './html.js';
import { acceptWebsockets, type ChangeHub } from './live.js';
import { handshake, icon, ring, signInPage, statusBadge, type Icon, type Tone } from './signal.js';

const HTTP_FOUND = 302;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_BAD_GATEWAY = 502;
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

/** A page of the gateway, never cached. */
function htmlPage(reply: FastifyReply, page: { status: number; title: string; body: string }): FastifyReply {
  return reply.code(page.status).type('text/html; charset=utf-8').header('cache-control', 'no-store').send(signInPage({ title: page.title, body: page.body }));
}

/** How an error page leads (design B): one ring in its tone around one icon, dashed for what ended, and one title. */
const ERROR_LOOKS = {
  invalidClient: { tone: 'attention', icon: 'alert', heading: 'This client cannot connect' },
  noPick: { tone: 'attention', icon: 'alert', heading: 'Pick how to connect' },
  signInEnded: { tone: 'ended', icon: 'timerOff', heading: 'Sign-in ended', isDashed: true },
  otherBrowser: { tone: 'attention', icon: 'shieldX', heading: 'Not this browser' },
  noFleet: { tone: 'attention', icon: 'shieldX', heading: 'No fleet for you' },
  outsidePartiesOff: { tone: 'ended', icon: 'powerOff', heading: 'Outside parties are off' },
  signInFailed: { tone: 'attention', icon: 'alert', heading: 'Sign-in did not go through' },
  requestEnded: { tone: 'ended', icon: 'timerOff', heading: 'Request ended', isDashed: true },
  noSignIn: { tone: 'ended', icon: 'ban', heading: 'No sign-in here' },
} as const satisfies Record<string, { tone: Tone; icon: Icon; heading: string; isDashed?: boolean }>;

/** A page that tells a person why their client got nothing, sending them nowhere. */
function errorPage(reply: FastifyReply, page: { status: number; title: string; look: keyof typeof ERROR_LOOKS; message: string }): FastifyReply {
  const look: { tone: Tone; icon: Icon; heading: string; isDashed?: boolean } = ERROR_LOOKS[page.look];
  const lead = ring({ tone: look.tone, center: { icon: look.icon }, label: look.heading, size: 144, ...(look.isDashed === undefined ? {} : { isDashed: look.isDashed }) });
  return htmlPage(reply, { status: page.status, title: page.title, body: `${lead}<h1>${escaped(look.heading)}</h1><p class="muted">${escaped(page.message)}</p>` });
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
    return errorPage(reply, { status: HTTP_BAD_REQUEST, title: 'Connect an MCP client', look: 'invalidClient', message: refusal.message });
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
  return `${handshake({ name: authorization.clientName, fleet: 'Aeolus' })}
<h1>Connect an MCP client</h1>
<p><strong>${escaped(authorization.clientName)}</strong> asks to call your fleet's ships through the gateway.</p>
<form method="get" action="/authorize/sign-in">${hidden}<div class="tiles">
<button class="tile" name="holder" value="account">${icon('signIn', 20)}<strong>Sign in as yourself</strong><span class="muted">The client acts as you.</span></button>
<button class="tile" name="holder" value="party">${icon('hourglass', 20)}<strong>Ask for access for this client</strong><span class="muted">An approver of your fleet decides; the client then acts as its own party.</span></button>
</div></form>
<p class="muted">Client ${escaped(authorization.clientId)}, sent back to ${escaped(authorization.redirectUri)}.</p>`;
}

/**
 * What the waiting page runs: it follows its request on the live channel
 * and goes to its own address again once told to, there to be sent on; it
 * goes there too when the request expires. A dropped socket opens again
 * with backoff. It never reloads on a timer.
 */
const WAITING_SCRIPT = `(function () {
  var wait = 500, expiry, HOUR = 3600000;
  function goOn() { location.replace(location.href); }
  function countDown() {
    var holder = document.querySelector('[data-expires-at]'), text = document.querySelector('[data-time-left]');
    if (!holder || !text) return;
    var hours = Math.max(0, Math.floor((Date.parse(holder.getAttribute('data-expires-at')) - Date.now()) / HOUR));
    text.textContent = Math.floor(hours / 24) + ' d ' + (hours % 24) + ' h';
  }
  setInterval(countDown, 60000);
  function open() {
    var socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '${WAITING_COOKIE.path}/live' + location.search);
    socket.onopen = function () { wait = 500; };
    socket.onmessage = function (event) {
      var told = JSON.parse(event.data);
      if (told.go) return goOn();
      if (told.expiresAt) { clearTimeout(expiry); expiry = setTimeout(goOn, Math.max(0, Date.parse(told.expiresAt) - Date.now())); }
    };
    socket.onclose = function (event) {
      if (event.code === ${String(CLOSE_OTHER_ORIGIN)}) return;
      setTimeout(open, wait);
      wait = Math.min(wait * 2, 10000);
    };
  }
  open();
})();`;

const MS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;

/** The time left of a request, in days and hours, as the waiting page's ring shows it. */
function timeLeft(expiresAt: Date, now: Date): string {
  const hours = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / MS_PER_HOUR));
  return `${String(Math.floor(hours / HOURS_PER_DAY))} d ${String(hours % HOURS_PER_DAY)} h`;
}

/** The waiting page: the client waits for approval, the ring counting its time left, and the page goes on by itself once it is decided. */
function waitingPage(waiting: { clientName: string; expiresAt: Date; now: Date }): string {
  const left = timeLeft(waiting.expiresAt, waiting.now);
  return `${handshake({ name: waiting.clientName, fleet: 'Aeolus' })}
<div data-expires-at="${waiting.expiresAt.toISOString()}">${ring({ tone: 'waiting', center: { text: left, icon: 'hourglass' }, label: `${left} left`, size: 176 })}</div>
${statusBadge({ tone: 'waiting', icon: 'hourglass', label: 'Waiting for approval' })}
<p><strong>${escaped(waiting.clientName)}</strong> waits for an approver of your fleet.</p>
<p><span class="going-on">Goes on by itself</span></p>
<p class="muted">Closed this page? Connect again later.</p>
<script>${WAITING_SCRIPT}</script>`;
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
      return errorPage(reply, { status: HTTP_BAD_REQUEST, title: 'Connect an MCP client', look: 'noPick', message: 'Pick on the page whether to sign in as yourself or to ask for access for the client.' });
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
    const title = 'Sign in';
    switch (refusal.kind) {
      case 'invalidClient':
      case 'redirect':
        return sendBack(reply, { refusal, issuer });
      case 'unknownSignIn':
        return errorPage(reply, { status: HTTP_BAD_REQUEST, title, look: 'signInEnded', message: 'This sign-in is unknown, or took over 10 minutes. Start again from your MCP client.' });
      case 'otherBrowser':
        return errorPage(reply, { status: HTTP_BAD_REQUEST, title, look: 'otherBrowser', message: 'This sign-in was started in another browser, so it is not yours to finish. Start again from your MCP client.' });
      case 'fleetNotServed':
        return errorPage(reply, { status: HTTP_FORBIDDEN, title, look: 'noFleet', message: 'This gateway does not serve the fleet you signed in to.' });
      case 'outsidePartiesOff':
        return errorPage(reply, { status: HTTP_FORBIDDEN, title, look: 'outsidePartiesOff', message: "Your fleet's outside parties are off, so no MCP client can ask for access. Sign in as yourself instead, or ask whoever runs your fleet." });
      case 'pagasaeRefused':
        return errorPage(reply, { status: HTTP_BAD_GATEWAY, title, look: 'signInFailed', message: `The sign-in did not go through: ${refusal.message}. Start again from your MCP client.` });
    }
  });

  // The sealed waiting goes in the query, as it is longer than a path parameter may be.
  server.get(WAITING_COOKIE.path, async (request, reply) => {
    const { waiting = '' } = fieldsOf(request.query);
    const read = await signIn.readWaiting({ waiting, browserSecret: cookieValue(WAITING_COOKIE, request.headers.cookie) });
    const title = 'Waiting for approval';
    if (read.isOk) {
      if (read.value.kind === 'waiting') {
        return htmlPage(reply, { status: 200, title, body: waitingPage({ ...read.value, now: signIn.clock.now() }) });
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
        return errorPage(reply, { status: HTTP_NOT_FOUND, title, look: 'requestEnded', message: 'This request is unknown, or ended long ago. Start again from your MCP client.' });
      case 'otherBrowser':
        return errorPage(reply, { status: HTTP_BAD_REQUEST, title, look: 'otherBrowser', message: 'This request was made in another browser, so it is not yours to follow. Start again from your MCP client.' });
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
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  }));

  server.get('/authorize', async (request, reply) => {
    if (deps.signIn === undefined) {
      return errorPage(reply, { status: HTTP_FORBIDDEN, title: 'Connect an MCP client', look: 'noSignIn', message: 'This gateway signs no one in, so no MCP client can connect to it: its operator sets pagasae first.' });
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
