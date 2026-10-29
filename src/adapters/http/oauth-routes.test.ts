import type { FleetId } from '@aeolus-fleet/common';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { fakeClientMetadataDocuments, fakeSecrets, ISSUER, memoryAuthorizationCodes, memoryIssuedTokens, memoryOAuthClients, PLUGIN_RESOURCE, RESOURCE } from '../../../test/support/oauth-fakes.js';
import { PROXY_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import { fakeWaitingSeals, memoryPendingRequests } from '../../../test/support/request-fakes.js';
import { CHARLOTTE_TOKENS, fakePagasae, memoryAccountGrants, fakeSignInSeals, PAGASAE_URL } from '../../../test/support/sign-in-fakes.js';
import { createExchangeToken } from '../../core/oauth/exchange-token.js';
import { createReadAuthorization } from '../../core/oauth/read-authorization.js';
import { createAskForClient } from '../../core/requests/ask-for-client.js';
import { createOpenRequest } from '../../core/requests/open-request.js';
import { createReadWaiting } from '../../core/requests/read-waiting.js';
import { createWatchWaiting } from '../../core/requests/watch-waiting.js';
import type { Pagasae } from '../../core/sign-in/ports.js';
import { createCompleteSignIn } from '../../core/sign-in/complete-sign-in.js';
import { createStartSignIn } from '../../core/sign-in/start-sign-in.js';
import { createChangeHub, type ChangeHub } from './live.js';
import { registerOAuthRoutes } from './oauth-routes.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const HOST = 'gateway.example.com';
const CLIENT = 'client-cursor';
const CALLBACK = 'https://cursor.example.com/callback';

let server: FastifyInstance;
let logged: string[];
let parties: ReturnType<typeof memoryPartyStore>;
let requests: ReturnType<typeof memoryPendingRequests>;
let served: FleetId[];
/** Whether the fleet's outside parties are on (interop I-3). */
let isOn: boolean;
/** pagasae redeems pagasae-code-1 for the verifier a person's start draws first, secret-1, unless a test sets it. */
let pagasae: Pagasae;
let hub: ChangeHub;

/** The routes over in-memory ports; signing people in through pagasae only where it is set. */
async function startServer(isSigningPeopleIn: boolean) {
  const clients = memoryOAuthClients();
  await clients.save({ clientId: CLIENT, fleetId: FLEET, name: 'Cursor <IDE>', redirectUris: [CALLBACK], secretHash: 'hash(cursor-secret)', grant: 'authorizationCode' });
  await clients.save({ clientId: MACHINE_CLIENT, fleetId: FLEET, name: 'agentcore', redirectUris: [], secretHash: 'hash(agentcore-secret)', grant: 'clientCredentials' });
  const codes = memoryAuthorizationCodes();
  const secrets = fakeSecrets();
  const clock = { now: () => new Date('2026-10-19T09:00:00.000Z') };
  const readAuthorization = createReadAuthorization({ clients, documents: fakeClientMetadataDocuments(), resources: [RESOURCE, PLUGIN_RESOURCE] });
  parties = memoryPartyStore();
  requests = memoryPendingRequests();
  served = [FLEET];
  isOn = true;
  pagasae = fakePagasae({ code: 'pagasae-code-1', verifier: 'secret-1', tokens: CHARLOTTE_TOKENS });
  hub = createChangeHub();
  const seals = fakeSignInSeals();
  const waitings = fakeWaitingSeals();
  let ids = 0;
  const askForClient = createAskForClient({
    parties,
    requests,
    openRequest: createOpenRequest({ requests, ids: { newRequestId: () => `req_${String((ids += 1))}` }, clock }),
    servesOutsideParties: () => Promise.resolve(isOn),
    waitings,
    codes,
    secrets,
    clock,
    issuer: ISSUER,
  });
  logged = [];
  server = Fastify({ logger: { level: 'warn', stream: { write: (line: string) => logged.push(line) } } });
  registerOAuthRoutes(server, {
    issuer: ISSUER,
    resource: RESOURCE,
    pluginResource: PLUGIN_RESOURCE,
    readAuthorization,
    exchangeToken: createExchangeToken({ clients, codes, tokens: memoryIssuedTokens(), secrets, clock, resource: RESOURCE, parties, servesOutsideParties: () => Promise.resolve(isOn) }),
    ...(isSigningPeopleIn
      ? {
          signIn: {
            start: createStartSignIn({ readAuthorization, pluginResource: PLUGIN_RESOURCE, seals, pagasae: fakePagasae({ refusal: 'unused' }), secrets, clock }),
            complete: (back) =>
              createCompleteSignIn({ readAuthorization, seals, pagasae, grants: memoryAccountGrants(), codes, secrets, clock, issuer: ISSUER, servesFleet: (fleetId) => Promise.resolve(served.includes(fleetId)), askForClient })(back),
            readWaiting: createReadWaiting({ waitings, readAuthorization, requests, parties, codes, secrets, clock, issuer: ISSUER }),
            watchWaiting: createWatchWaiting({ waitings, requests, parties, clock }),
            hub,
            clock,
          },
        }
      : {}),
  });
  await server.ready();
}

beforeEach(async () => {
  await startServer(true);
});

afterEach(async () => {
  await server.close();
});

const REQUEST = { response_type: 'code', client_id: CLIENT, redirect_uri: CALLBACK, code_challenge: 'S256(verifier-1)', code_challenge_method: 'S256', resource: RESOURCE, state: 'state-1' };

/** The browser that started the sign-in holds the secret drawn after the verifier. */
const STARTED_BROWSER = 'aeolus_sign_in=secret-2';

function authorizePage(request: Record<string, string> = REQUEST) {
  return server.inject({ url: `/authorize?${new URLSearchParams(request).toString()}`, headers: { host: HOST } });
}

/** The person picks what the client acts as on the page, and starts signing in. */
function signIn(holder: string, request: Record<string, string> = REQUEST) {
  return server.inject({ url: `/authorize/sign-in?${new URLSearchParams({ ...request, holder }).toString()}`, headers: { host: HOST } });
}

/** pagasae sends the browser back, holding the cookie given, or none. */
function callback(query: Record<string, string>, cookie: string | null = STARTED_BROWSER) {
  return server.inject({ url: `/pagasae/callback?${new URLSearchParams(query).toString()}`, headers: { host: HOST, ...(cookie === null ? {} : { cookie }) } });
}

/** A person asks for access for the client, and comes back from pagasae. */
async function askedForAccess() {
  await signIn('party');
  return callback({ state: 'sealed-1', code: 'pagasae-code-1' });
}

/** The browser opens the waiting page, holding the cookie given. */
function waitingPage(waiting: string, cookie: string | null = 'aeolus_waiting=secret-2') {
  return server.inject({ url: `/authorize/waiting?waiting=${waiting}`, headers: { host: HOST, ...(cookie === null ? {} : { cookie }) } });
}

/** The client's party, crewed. */
async function aCrewedParty() {
  await parties.save({ fleetId: FLEET, name: 'cursor', kind: 'mcpClient', clientId: CLIENT, state: 'crewed', proxyShipId: PROXY_SHIP_ID, secret: null, crewToken: 'aeolus_ct_v1_cursor', requestId: 'req_1', requestHash: 'h', approvedAt: new Date('2026-10-19T09:00:00.000Z') });
}

/** The client id of a party with no human at the authorize step (vendor platforms V4). */
const MACHINE_CLIENT = 'client-agentcore';

/** An approver added the machine client as a party, and the gateway crews its proxy ship. */
async function aClientCredentialsParty() {
  await parties.save({ fleetId: FLEET, name: 'agentcore', kind: 'mcpClient', clientId: MACHINE_CLIENT, state: 'crewed', proxyShipId: PROXY_SHIP_ID, secret: null, crewToken: 'aeolus_ct_v1_agentcore', requestId: 'req_2', requestHash: 'h', approvedAt: new Date('2026-10-19T09:00:00.000Z') });
}

const MACHINE_BASIC = { authorization: `Basic ${Buffer.from(`${MACHINE_CLIENT}:agentcore-secret`).toString('base64')}` };

/** The client's request decided as an approver would. */
async function decided(outcome: 'approved' | 'denied') {
  await requests.decide(FLEET, { requestId: 'req_1', from: ['pending'], decision: { outcome, decidedBy: { kind: 'operator' }, decidedAt: new Date('2026-10-19T09:00:00.000Z') }, notices: [] });
}

function token(form: Record<string, string>, headers: Record<string, string> = {}) {
  return server.inject({ method: 'POST', url: '/token', headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded', ...headers }, payload: new URLSearchParams(form).toString() });
}

/** The waiting page's live channel, as its browser opens it, holding the cookie given. */
async function waitingLive(waiting: string, cookie = 'aeolus_waiting=secret-2') {
  const received: unknown[] = [];
  // Heard from before the socket opens, as the first message may come at once.
  await server.injectWS(`/authorize/waiting/live?waiting=${waiting}`, { headers: { host: HOST, origin: `http://${HOST}`, cookie } }, { onInit: (socket) => socket.on('message', (data: Buffer) => received.push(JSON.parse(data.toString()))) });
  return { received };
}

async function until(isDone: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!isDone()) {
    if (Date.now() > deadline) {
      throw new Error('not in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const tokenAnswer = z.object({ access_token: z.string(), token_type: z.literal('Bearer'), expires_in: z.number(), refresh_token: z.string() });

describe("the gateway's OAuth metadata", () => {
  it.each(['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource'])('names its authorization server for the MCP endpoint at %s (RFC 9728)', async (path) => {
    const answer = await server.inject({ url: path });

    expect(answer.json()).toEqual({ resource: RESOURCE, authorization_servers: [ISSUER], bearer_methods_supported: ['header'] });
  });

  it('states what the authorization server serves (RFC 8414), the ID-JAG grant among them where people sign in through pagasae', async () => {
    const answer = await server.inject({ url: '/.well-known/oauth-authorization-server' });

    expect(answer.json()).toEqual({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials', 'urn:ietf:params:oauth:grant-type:jwt-bearer'],
      authorization_grant_profiles_supported: ['urn:ietf:params:oauth:grant-profile:id-jag'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });
});


describe('a person comes to /authorize from an MCP client (Q1 a, decision 0054)', () => {
  it("goes to the web app's pick page with the request, to choose: sign in as yourself, or ask for access for this client", async () => {
    const page = await authorizePage();

    expect({ status: page.statusCode, location: page.headers.location }).toEqual({ status: 302, location: `/authorize/pick?${new URLSearchParams(REQUEST).toString()}` });
  });

  it("goes to the web app's page saying the client is unknown, sending the client nothing", async () => {
    const page = await authorizePage({ ...REQUEST, client_id: 'client-unknown' });

    expect({ status: page.statusCode, location: page.headers.location }).toEqual({ status: 302, location: '/authorize/failed?reason=invalidClient' });
  });

  it('sends a known client back with the error for a request it got wrong', async () => {
    const page = await authorizePage({ ...REQUEST, code_challenge_method: 'plain' });

    expect({ status: page.statusCode, error: new URL(String(page.headers.location)).searchParams.get('error') }).toEqual({ status: 302, error: 'invalid_request' });
  });

  it('is sent to pagasae once they pick, with the browser\'s secret in a cookie only the callback reads, for 10 minutes', async () => {
    const answer = await signIn('account');

    expect({ status: answer.statusCode, location: answer.headers.location, cookie: answer.headers['set-cookie'] }).toEqual({
      status: 302,
      location: `${PAGASAE_URL}/oauth/authorize?state=sealed-1&code_challenge=S256(secret-1)`,
      cookie: 'aeolus_sign_in=secret-2; Path=/pagasae/callback; Max-Age=600; HttpOnly; SameSite=Lax',
    });
  });

  it('is told a pick the page does not offer, sent nowhere', async () => {
    const answer = await signIn('argo');

    expect({ status: answer.statusCode, location: answer.headers.location }).toEqual({ status: 302, location: '/authorize/failed?reason=noPick' });
  });
});

describe('a person comes to /authorize from the plugin address (chatgpt-plugin design, 6)', () => {
  const PLUGIN_REQUEST = { ...REQUEST, resource: PLUGIN_RESOURCE };

  it('the plugin path has its own metadata: its resource is exactly the plugin address (RFC 9728, 3.3)', async () => {
    const answer = await server.inject({ url: '/.well-known/oauth-protected-resource/plugin/mcp' });

    expect(answer.json()).toEqual({ resource: PLUGIN_RESOURCE, authorization_servers: [ISSUER], bearer_methods_supported: ['header'] });
  });

  it("a person adding the plugin never sees the choice: they are sent straight to pagasae, signing in as themselves, the browser's secret in the callback's cookie", async () => {
    const answer = await authorizePage(PLUGIN_REQUEST);

    expect({ status: answer.statusCode, location: answer.headers.location, cookie: answer.headers['set-cookie'] }).toEqual({
      status: 302,
      location: `${PAGASAE_URL}/oauth/authorize?state=sealed-1&code_challenge=S256(secret-1)`,
      cookie: 'aeolus_sign_in=secret-2; Path=/pagasae/callback; Max-Age=600; HttpOnly; SameSite=Lax',
    });
    const back = await callback({ state: 'sealed-1', code: 'pagasae-code-1' });
    expect(new URL(String(back.headers.location)).origin).toBe(new URL(CALLBACK).origin);
    expect(requests.held).toEqual([]);
  });

  it('the plugin address is open to anyone and grants nothing: no code is issued without a signed-in account, and no outside-party request is made', async () => {
    await authorizePage(PLUGIN_REQUEST);
    const back = await callback({ state: 'sealed-1', error: 'access_denied' });

    expect(new URL(String(back.headers.location)).searchParams.get('code')).toBeNull();
    expect(requests.held).toEqual([]);
  });

  it('the plugin address cannot ask for access for the client: a pick of the client is sent back with an error, and no approver is asked', async () => {
    const answer = await signIn('party', PLUGIN_REQUEST);

    expect({ status: answer.statusCode, error: new URL(String(answer.headers.location)).searchParams.get('error') }).toEqual({ status: 302, error: 'invalid_request' });
    expect(requests.held).toEqual([]);
  });

  it('a resource the gateway does not serve: the refusal goes back to the client and no sign-in starts', async () => {
    const answer = await authorizePage({ ...REQUEST, resource: 'http://gateway.example.com/plugin/other' });

    expect({ status: answer.statusCode, error: new URL(String(answer.headers.location)).searchParams.get('error'), cookie: answer.headers['set-cookie'] }).toEqual({ status: 302, error: 'invalid_target', cookie: undefined });
  });
});

describe('a person who signed in as themselves is sent back from pagasae', () => {
  it("to the client with the gateway's code, and the browser's secret is cleared", async () => {
    await signIn('account');

    const answer = await callback({ state: 'sealed-1', code: 'pagasae-code-1' }, `console=other; ${STARTED_BROWSER}`);

    expect({ status: answer.statusCode, location: answer.headers.location, cookie: answer.headers['set-cookie'] }).toEqual({
      status: 302,
      location: `${CALLBACK}?code=secret-4&state=state-1&iss=${encodeURIComponent(ISSUER)}`,
      cookie: 'aeolus_sign_in=; Path=/pagasae/callback; Max-Age=0; HttpOnly; SameSite=Lax',
    });
  });

  it('is told a sign-in started in another browser is not theirs, and sent nowhere (login CSRF)', async () => {
    await signIn('account');

    const answers = await Promise.all([callback({ state: 'sealed-1', code: 'pagasae-code-1' }, null), callback({ state: 'sealed-1', code: 'pagasae-code-1' }, 'aeolus_sign_in=secret-9')]);

    expect(answers.map((answer) => answer.headers.location)).toEqual(['/authorize/failed?reason=otherBrowser', '/authorize/failed?reason=otherBrowser']);
  });

  it('is told a sign-in it did not start, or started too long ago, is unknown, and sent nowhere', async () => {
    const answer = await callback({ state: 'forged', code: 'pagasae-code-1' });

    expect({ status: answer.statusCode, location: answer.headers.location }).toEqual({ status: 302, location: '/authorize/failed?reason=unknownSignIn' });
  });

  it('is told this gateway does not serve the fleet they signed in to', async () => {
    served = [];
    await signIn('account');

    const answer = await callback({ state: 'sealed-1', code: 'pagasae-code-1' });

    expect({ status: answer.statusCode, location: answer.headers.location }).toEqual({ status: 302, location: '/authorize/failed?reason=fleetNotServed' });
  });

  it('is told when pagasae did not take its code', async () => {
    pagasae = fakePagasae({ refusal: 'invalid_grant' });
    await signIn('account');

    const answer = await callback({ state: 'sealed-1', code: 'pagasae-code-1' });

    expect({ status: answer.statusCode, location: answer.headers.location }).toEqual({ status: 302, location: '/authorize/failed?reason=pagasaeRefused' });
  });

  it("logs pagasae's reason for not taking its code", async () => {
    pagasae = fakePagasae({ refusal: 'invalid_grant' });
    await signIn('account');

    await callback({ state: 'sealed-1', code: 'pagasae-code-1' });

    expect(logged.join('')).toContain('invalid_grant');
  });
});

describe('a person who asked for access for the client (decision 0056)', () => {
  it("waits on the gateway's page, the browser's secret moved to a cookie only that page reads, for the request's 7 days", async () => {
    const answer = await askedForAccess();

    expect({ status: answer.statusCode, location: answer.headers.location, cookies: answer.headers['set-cookie'] }).toEqual({
      status: 302,
      location: '/authorize/waiting?waiting=waiting-1',
      cookies: ['aeolus_sign_in=; Path=/pagasae/callback; Max-Age=0; HttpOnly; SameSite=Lax', 'aeolus_waiting=secret-2; Path=/authorize/waiting; Max-Age=604800; HttpOnly; SameSite=Lax'],
    });
  });

  it("goes to the web app's waiting page while the client waits for approval, under the waiting cookie's path", async () => {
    await askedForAccess();

    const page = await waitingPage('waiting-1');

    expect({ status: page.statusCode, location: page.headers.location }).toEqual({ status: 302, location: '/authorize/waiting/approval?waiting=waiting-1' });
  });

  it('is told over the live channel when its request expires, then to go on once it is decided', async () => {
    await askedForAccess();
    const live = await waitingLive('waiting-1');
    await until(() => live.received.length === 1);

    await decided('denied');
    hub.publish({ fleetId: FLEET, topic: 'requests' });

    await until(() => live.received.length === 2);
    expect(live.received).toEqual([{ expiresAt: '2026-10-26T09:00:00.000Z' }, { go: true }]);
  });

  it("hears nothing over the live channel for another fleet's change", async () => {
    await askedForAccess();
    const live = await waitingLive('waiting-1');
    await until(() => live.received.length === 1);

    await decided('denied');
    hub.publish({ fleetId: 'flt_01m3tb1zgr5h2ffee12xnch8zz', topic: 'requests' });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(live.received).toHaveLength(1);
  });

  it('is told at once to go on over the live channel when it does not wait, so its page says why', async () => {
    await askedForAccess();

    const live = await waitingLive('waiting-1', 'aeolus_waiting=secret-9');

    await until(() => live.received.length === 1);
    expect(live.received).toEqual([{ go: true }]);
  });

  it("goes on to the client with its party's code once approved, and the cookie is cleared", async () => {
    await askedForAccess();
    await decided('approved');
    await aCrewedParty();

    const answer = await waitingPage('waiting-1');

    expect({ status: answer.statusCode, location: answer.headers.location, cookie: answer.headers['set-cookie'] }).toEqual({
      status: 302,
      location: `${CALLBACK}?code=secret-3&state=state-1&iss=${encodeURIComponent(ISSUER)}`,
      cookie: 'aeolus_waiting=; Path=/authorize/waiting; Max-Age=0; HttpOnly; SameSite=Lax',
    });
  });

  it('goes on to the client with access_denied once denied', async () => {
    await askedForAccess();
    await decided('denied');

    const answer = await waitingPage('waiting-1');

    expect(new URL(String(answer.headers.location)).searchParams.get('error')).toBe('access_denied');
  });

  it("is sent straight back to the client with its party's code when it has one", async () => {
    await aCrewedParty();

    const answer = await askedForAccess();

    expect(answer.headers.location).toBe(`${CALLBACK}?code=secret-3&state=state-1&iss=${encodeURIComponent(ISSUER)}`);
  });

  it("is told when the fleet's outside parties are off, sent nowhere (interop I-3)", async () => {
    isOn = false;

    const answer = await askedForAccess();

    expect({ status: answer.statusCode, location: answer.headers.location }).toEqual({ status: 302, location: '/authorize/failed?reason=outsidePartiesOff' });
  });

  it('is told a wait started in another browser is not theirs, or one the gateway does not know is unknown', async () => {
    await askedForAccess();

    const answers = await Promise.all([waitingPage('waiting-1', null), waitingPage('waiting-1', 'aeolus_waiting=secret-9'), waitingPage('waiting-9')]);

    expect(answers.map((answer) => answer.headers.location)).toEqual(['/authorize/failed?reason=otherBrowserWaiting', '/authorize/failed?reason=otherBrowserWaiting', '/authorize/failed?reason=unknownWaiting']);
  });
});

describe('a gateway where no pagasae is set', () => {
  beforeEach(async () => {
    await server.close();
    await startServer(false);
  });

  it('says at /authorize that it signs no one in, so no client asks (A a)', async () => {
    const page = await authorizePage();

    expect({ status: page.statusCode, location: page.headers.location }).toEqual({ status: 302, location: '/authorize/failed?reason=noSignIn' });
  });

  it('knows no sign-in, callback from pagasae or waiting page', async () => {
    const answers = await Promise.all([signIn('account'), server.inject({ url: '/pagasae/callback?state=sealed-1&code=pagasae-code-1', headers: { host: HOST } }), waitingPage('waiting-1')]);

    expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404]);
  });
});

describe('a client takes its code for tokens at /token', () => {
  it('answers the tokens as JSON, never cached, the client authenticated with HTTP Basic', async () => {
    await aCrewedParty();
    await askedForAccess();

    const answer = await token({ grant_type: 'authorization_code', code: 'secret-3', redirect_uri: CALLBACK, code_verifier: 'verifier-1', resource: RESOURCE }, { authorization: `Basic ${Buffer.from(`${CLIENT}:cursor-secret`).toString('base64')}` });

    expect({ status: answer.statusCode, cache: answer.headers['cache-control'], body: tokenAnswer.safeParse(answer.json()).success }).toEqual({ status: 200, cache: 'no-store', body: true });
  });

  it('takes the client secret in the form too', async () => {
    await aCrewedParty();
    await askedForAccess();

    const answer = await token({ grant_type: 'authorization_code', code: 'secret-3', redirect_uri: CALLBACK, code_verifier: 'verifier-1', client_id: CLIENT, client_secret: 'cursor-secret' });

    expect(answer.statusCode).toBe(200);
  });

  it('answers 401 invalid_client to a wrong secret', async () => {
    const answer = await token({ grant_type: 'authorization_code', code: 'secret-1', redirect_uri: CALLBACK, code_verifier: 'verifier-1', client_id: CLIENT, client_secret: 'wrong' });

    expect({ status: answer.statusCode, body: answer.json<unknown>() }).toMatchObject({ status: 401, body: { error: 'invalid_client' } });
  });

  it('answers 400 with the error for a code it does not know', async () => {
    const answer = await token({ grant_type: 'authorization_code', code: 'unknown', redirect_uri: CALLBACK, code_verifier: 'verifier-1', client_id: CLIENT, client_secret: 'cursor-secret' });

    expect({ status: answer.statusCode, body: answer.json<unknown>() }).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
  });
});

describe('a client party signs in with client credentials at /token (vendor platforms V4)', () => {
  it('answers an access token for one hour and no refresh token, never cached', async () => {
    await aClientCredentialsParty();

    const answer = await token({ grant_type: 'client_credentials', resource: RESOURCE }, MACHINE_BASIC);

    expect({ status: answer.statusCode, cache: answer.headers['cache-control'], body: answer.json<unknown>() }).toEqual({
      status: 200,
      cache: 'no-store',
      body: { access_token: 'secret-1', token_type: 'Bearer', expires_in: 3600 },
    });
  });

  it("answers 400 unauthorized_client while the fleet's outside parties are off (interop I-3)", async () => {
    await aClientCredentialsParty();
    isOn = false;

    const answer = await token({ grant_type: 'client_credentials', resource: RESOURCE }, MACHINE_BASIC);

    expect({ status: answer.statusCode, body: answer.json<unknown>() }).toMatchObject({ status: 400, body: { error: 'unauthorized_client' } });
  });

  it('answers 401 invalid_client to a client whose party was retired', async () => {
    const answer = await token({ grant_type: 'client_credentials', resource: RESOURCE }, MACHINE_BASIC);

    expect({ status: answer.statusCode, body: answer.json<unknown>() }).toMatchObject({ status: 401, body: { error: 'invalid_client' } });
  });
});
