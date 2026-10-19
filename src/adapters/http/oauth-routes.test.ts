import type { FleetId } from '@aeolus-fleet/common';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { fakeClientMetadataDocuments, fakeFleetEndpoints, fakeSecrets, ISSUER, memoryAuthorizationCodes, memoryIssuedTokens, memoryOAuthClients, RESOURCE } from '../../../test/support/oauth-fakes.js';
import { createApproveAuthorization } from '../../core/oauth/approve-authorization.js';
import { createExchangeToken } from '../../core/oauth/exchange-token.js';
import { createReadAuthorization } from '../../core/oauth/read-authorization.js';
import type { AuthenticateOperator } from '../../core/operator/authenticate-operator.js';
import { err, ok } from '../../core/shared/result.js';
import { createApproveClientParty } from '../../core/parties/approve-party.js';
import { createReadClientParty } from '../../core/parties/read-client-party.js';
import { SHIP_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { plainHasher } from '../../../test/support/memory-installation.js';
import { CHARLOTTE_SHIP_ID, OWNER_SHIP_ID, fakeProxyShipFleet, memoryPartyStore } from '../../../test/support/party-fakes.js';
import { aProviderMetadata, fakeProviderDiscovery, fakeProviderSignIn, GOOGLE_ISSUER, memoryIdentityProviders, memorySignIns } from '../../../test/support/federation-fakes.js';
import { createAuthorizePerson } from '../../core/federation/authorize-person.js';
import { createCompleteSignIn } from '../../core/federation/complete-sign-in.js';
import { createReadIdentityProvider } from '../../core/federation/read-identity-provider.js';
import { createStartSignIn } from '../../core/federation/start-sign-in.js';
import { registerOAuthRoutes } from './oauth-routes.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const ARGO = 'aeolus_session=argo';
const VIEWER = 'aeolus_session=viewer';
const HOST = 'gateway.example.com';
const CLIENT = 'client-cursor';
const CALLBACK = 'https://cursor.example.com/callback';

const authenticateOperator: AuthenticateOperator = (cookie) => {
  if (cookie === ARGO) {
    return Promise.resolve(ok({ fleetId: FLEET, kind: 'operator' as const, scopes: ['fleet:read', 'fleet:manage'] }));
  }
  if (cookie === VIEWER) {
    return Promise.resolve(ok({ fleetId: FLEET, kind: 'viewer' as const, scopes: ['fleet:read'] }));
  }
  return Promise.resolve(err({ kind: 'NOT_THE_OPERATOR' as const, message: 'Sign in to the console of your fleet' }));
};

let server: FastifyInstance;
let parties: ReturnType<typeof memoryPartyStore>;
let providers: ReturnType<typeof memoryIdentityProviders>;

beforeEach(async () => {
  const clients = memoryOAuthClients();
  await clients.save({ clientId: CLIENT, fleetId: FLEET, name: 'Cursor <IDE>', redirectUris: [CALLBACK], secretHash: 'hash(cursor-secret)' });
  const codes = memoryAuthorizationCodes();
  const secrets = fakeSecrets();
  const clock = { now: () => new Date('2026-10-19T09:00:00.000Z') };
  const readAuthorization = createReadAuthorization({ clients, documents: fakeClientMetadataDocuments(), endpoints: fakeFleetEndpoints() });
  parties = memoryPartyStore();
  const connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: new Date('2026-10-19T09:00:00.000Z') });
  const approveClientParty = createApproveClientParty({ connections, parties, door: fakeProxyShipFleet().door, hasher: plainHasher, clock });
  providers = memoryIdentityProviders();
  const discovery = fakeProviderDiscovery({ [GOOGLE_ISSUER]: aProviderMetadata(GOOGLE_ISSUER) });
  const signIns = memorySignIns();
  const providerSignIn = fakeProviderSignIn({ 'google-code': { issuer: GOOGLE_ISSUER, subject: '1078', email: 'charlotte@example.com' } });
  const callbackUrl = `${ISSUER}/oidc/callback`;
  server = Fastify({ logger: false });
  registerOAuthRoutes(server, {
    readIdentityProvider: createReadIdentityProvider({ providers }),
    startSignIn: createStartSignIn({ readAuthorization, providers, discovery, signIns, secrets, clock, callbackUrl }),
    completeSignIn: createCompleteSignIn({ signIns, providers, discovery, providerSignIn, secrets, clock, callbackUrl }),
    authorizePerson: createAuthorizePerson({ readAuthorization, parties, codes, secrets, clock, issuer: ISSUER }),
    issuer: ISSUER,
    endpoints: fakeFleetEndpoints(),
    fleetUrl: 'https://fleet.example.com',
    authenticateOperator,
    readAuthorization,
    approveAuthorization: createApproveAuthorization({ readAuthorization, codes, secrets, clock, issuer: ISSUER, parties, approveClientParty }),
    readClientParty: createReadClientParty({ parties }),
    exchangeToken: createExchangeToken({ clients, codes, tokens: memoryIssuedTokens(), secrets, clock }),
  });
  await server.ready();
});

afterEach(async () => {
  await server.close();
});

/** The party argo names for the client at its first approval. */
const NEW_PARTY = { partyRequestId: 'r-1', partyName: 'cursor', ownerShipId: OWNER_SHIP_ID };

const REQUEST = { response_type: 'code', client_id: CLIENT, redirect_uri: CALLBACK, code_challenge: 'S256(verifier-1)', code_challenge_method: 'S256', resource: RESOURCE, state: 'state-1' };

function authorizePage(cookie: string | undefined, request: Record<string, string> = REQUEST) {
  return server.inject({ url: `/authorize?${new URLSearchParams(request).toString()}`, headers: { host: HOST, ...(cookie === undefined ? {} : { cookie }) } });
}

function decide(form: Record<string, string> & { cookie?: string; origin?: string }) {
  const { cookie, origin, ...fields } = form;
  return server.inject({
    method: 'POST',
    url: '/authorize',
    headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded', cookie: cookie ?? ARGO, origin: origin ?? `http://${HOST}` },
    payload: new URLSearchParams(fields).toString(),
  });
}

function token(form: Record<string, string>, headers: Record<string, string> = {}) {
  return server.inject({ method: 'POST', url: '/token', headers: { host: HOST, 'content-type': 'application/x-www-form-urlencoded', ...headers }, payload: new URLSearchParams(form).toString() });
}

const tokenAnswer = z.object({ access_token: z.string(), token_type: z.literal('Bearer'), expires_in: z.number(), refresh_token: z.string() });

describe("the gateway's OAuth metadata", () => {
  it("names its authorization server for a fleet's MCP endpoint (RFC 9728)", async () => {
    const answer = await server.inject({ url: '/.well-known/oauth-protected-resource/fleets/fleetaaa/mcp' });

    expect(answer.json()).toEqual({ resource: RESOURCE, authorization_servers: [ISSUER], bearer_methods_supported: ['header'] });
  });

  it.each(['/.well-known/oauth-protected-resource/fleets/fleetzzz/mcp', '/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource'])('knows no protected resource at %s: no fleet has that MCP endpoint', async (path) => {
    const answer = await server.inject({ url: path });

    expect(answer.statusCode).toBe(404);
  });

  it('states what the authorization server serves (RFC 8414)', async () => {
    const answer = await server.inject({ url: '/.well-known/oauth-authorization-server' });

    expect(answer.json()).toEqual({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });
});

describe('argo approves an MCP client at /authorize, signed in to the console', () => {
  it('shows argo the client, escaped, with the forms to approve or deny it', async () => {
    const page = await authorizePage(ARGO);

    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Cursor &lt;IDE&gt;');
    expect(page.body).toContain('name="decision" value="approve"');
    expect(page.body).not.toContain('<IDE>');
  });

  it('asks a caller with no session to sign in to the console', async () => {
    const page = await authorizePage(undefined);

    expect(page.statusCode).toBe(401);
    expect(page.body).toContain('href="https://fleet.example.com"');
  });

  it('refuses a viewer, who may not approve', async () => {
    const page = await authorizePage(VIEWER);

    expect(page.statusCode).toBe(403);
  });

  it('says on the page that the client is unknown, sending nobody anywhere', async () => {
    const page = await authorizePage(ARGO, { ...REQUEST, client_id: 'client-unknown' });

    expect(page.statusCode).toBe(400);
    expect(page.headers.location).toBeUndefined();
  });

  it('sends a known client back with the error for a request it got wrong', async () => {
    const page = await authorizePage(ARGO, { ...REQUEST, code_challenge_method: 'plain' });

    expect(page.statusCode).toBe(302);
    expect(new URL(String(page.headers.location)).searchParams.get('error')).toBe('invalid_request');
  });

  it('sends the client back with a code once argo approves', async () => {
    const answer = await decide({ ...REQUEST, ...NEW_PARTY, decision: 'approve' });

    expect(answer.statusCode).toBe(302);
    expect(String(answer.headers.location)).toBe(`${CALLBACK}?code=secret-1&state=state-1&iss=${encodeURIComponent(ISSUER)}`);
  });

  it("asks argo to name the party of a client that is none yet", async () => {
    const page = await authorizePage(ARGO);

    expect(page.body).toContain('name="partyName"');
  });

  it('names the party of a client that is one, asking nothing more', async () => {
    await decide({ ...REQUEST, ...NEW_PARTY, decision: 'approve' });

    const page = await authorizePage(ARGO);

    expect({ isParty: page.body.includes('the party <strong>cursor</strong>'), isAsking: page.body.includes('name="partyName"') }).toEqual({ isParty: true, isAsking: false });
  });

  it('shows the page again, asking for the party, when argo approves a client that is none without naming it', async () => {
    const answer = await decide({ ...REQUEST, decision: 'approve' });

    expect({ status: answer.statusCode, isAsking: answer.body.includes('name="partyName"') }).toEqual({ status: 400, isAsking: true });
  });

  it('sends the client back with access_denied once argo denies', async () => {
    const answer = await decide({ ...REQUEST, decision: 'deny' });

    expect(new URL(String(answer.headers.location)).searchParams.get('error')).toBe('access_denied');
  });

  it('refuses a decision sent from another origin, or by a viewer', async () => {
    const answers = await Promise.all([decide({ ...REQUEST, ...NEW_PARTY, decision: 'approve', origin: 'https://evil.example.com' }), decide({ ...REQUEST, ...NEW_PARTY, decision: 'approve', cookie: VIEWER })]);

    expect(answers.map((answer) => answer.statusCode)).toEqual([403, 403]);
  });
});

describe('a client takes its code for tokens at /token', () => {
  it('answers the tokens as JSON, never cached, the client authenticated with HTTP Basic', async () => {
    await decide({ ...REQUEST, ...NEW_PARTY, decision: 'approve' });

    const answer = await token({ grant_type: 'authorization_code', code: 'secret-1', redirect_uri: CALLBACK, code_verifier: 'verifier-1', resource: RESOURCE }, { authorization: `Basic ${Buffer.from(`${CLIENT}:cursor-secret`).toString('base64')}` });

    expect({ status: answer.statusCode, cache: answer.headers['cache-control'], body: tokenAnswer.safeParse(answer.json()).success }).toEqual({ status: 200, cache: 'no-store', body: true });
  });

  it('takes the client secret in the form too', async () => {
    await decide({ ...REQUEST, ...NEW_PARTY, decision: 'approve' });

    const answer = await token({ grant_type: 'authorization_code', code: 'secret-1', redirect_uri: CALLBACK, code_verifier: 'verifier-1', client_id: CLIENT, client_secret: 'cursor-secret' });

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

describe('a person signs in at /authorize with the fleet\'s identity provider (Q25: no console session)', () => {
  /** argo set Google as the fleet's identity provider. */
  async function withGoogle(): Promise<void> {
    await providers.save({ fleetId: FLEET, issuer: GOOGLE_ISSUER, clientId: 'gateway.apps.googleusercontent.com', clientSecret: 'google-secret', setAt: new Date('2026-10-19T09:00:00.000Z') });
  }

  it("offers a caller with no session to sign in with the fleet's identity provider, and argo the console", async () => {
    await withGoogle();

    const page = await authorizePage(undefined);

    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(`href="/authorize/sign-in?${new URLSearchParams(REQUEST).toString().replaceAll('&', '&amp;')}"`);
    expect(page.body).toContain('accounts.google.com');
    expect(page.body).toContain('href="https://fleet.example.com"');
  });

  it('sends the person to the identity provider', async () => {
    await withGoogle();

    const answer = await server.inject({ url: `/authorize/sign-in?${new URLSearchParams(REQUEST).toString()}`, headers: { host: HOST } });

    expect(answer.statusCode).toBe(302);
    expect(answer.headers.location).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?response_type=code&client_id=gateway\.apps\.googleusercontent\.com&/);
  });

  it('says on the page that people cannot sign in where the fleet has no identity provider', async () => {
    const answer = await server.inject({ url: `/authorize/sign-in?${new URLSearchParams(REQUEST).toString()}`, headers: { host: HOST } });

    expect(answer.statusCode).toBe(409);
    expect(answer.body).toContain('no identity provider');
  });

  /** The person comes back from Google, signed in as Charlotte. */
  async function backFromGoogle() {
    await withGoogle();
    const started = await server.inject({ url: `/authorize/sign-in?${new URLSearchParams(REQUEST).toString()}`, headers: { host: HOST } });
    const state = new URL(z.string().parse(started.headers.location)).searchParams.get('state');
    return server.inject({ url: `/oidc/callback?${new URLSearchParams({ state: z.string().parse(state), code: 'google-code' }).toString()}`, headers: { host: HOST } });
  }

  it('sends a person argo mapped back to their MCP client, with a code and the issuer', async () => {
    await parties.save({ fleetId: FLEET, name: 'charlotte', kind: 'person', email: 'charlotte@example.com', issuer: null, subject: null, ownerShipId: CHARLOTTE_SHIP_ID, state: 'crewed', proxyShipId: CHARLOTTE_SHIP_ID, secret: null, crewToken: 'aeolus_ct_v1_charlotte', requestId: CHARLOTTE_SHIP_ID, requestHash: '', approvedAt: new Date('2026-10-19T09:00:00.000Z') });

    const back = await backFromGoogle();

    expect(back.statusCode).toBe(302);
    const sentBack = new URL(z.string().parse(back.headers.location));
    expect({ to: `${sentBack.origin}${sentBack.pathname}`, isCoded: sentBack.searchParams.has('code'), state: sentBack.searchParams.get('state'), iss: sentBack.searchParams.get('iss') }).toEqual({ to: CALLBACK, isCoded: true, state: 'state-1', iss: ISSUER });
  });

  it("shows who the provider vouched for, and that argo has not given them this fleet's ship yet", async () => {
    const back = await backFromGoogle();

    expect(back.statusCode).toBe(403);
    expect(back.body).toContain('charlotte@example.com');
  });

  it('refuses a sign-in it did not start, saying why', async () => {
    const back = await server.inject({ url: '/oidc/callback?state=forged&code=google-code', headers: { host: HOST } });

    expect(back.statusCode).toBe(400);
    expect(back.body).toContain('class="error"');
  });
});
