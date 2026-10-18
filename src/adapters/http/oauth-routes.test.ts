import type { FleetId } from '@aeolus-fleet/common';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { fakeClientMetadataDocuments, fakeSecrets, ISSUER, memoryAuthorizationCodes, memoryIssuedTokens, memoryOAuthClients, RESOURCE } from '../../../test/support/oauth-fakes.js';
import { createApproveAuthorization } from '../../core/oauth/approve-authorization.js';
import { createExchangeToken } from '../../core/oauth/exchange-token.js';
import { createReadAuthorization } from '../../core/oauth/read-authorization.js';
import type { AuthenticateOperator } from '../../core/operator/authenticate-operator.js';
import { err, ok } from '../../core/shared/result.js';
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

beforeEach(async () => {
  const clients = memoryOAuthClients();
  await clients.save({ clientId: CLIENT, fleetId: FLEET, name: 'Cursor <IDE>', redirectUris: [CALLBACK], secretHash: 'hash(cursor-secret)' });
  const codes = memoryAuthorizationCodes();
  const secrets = fakeSecrets();
  const clock = { now: () => new Date('2026-10-19T09:00:00.000Z') };
  const readAuthorization = createReadAuthorization({ clients, documents: fakeClientMetadataDocuments(), resource: RESOURCE });
  server = Fastify({ logger: false });
  registerOAuthRoutes(server, {
    issuer: ISSUER,
    resource: RESOURCE,
    fleetUrl: 'https://fleet.example.com',
    authenticateOperator,
    readAuthorization,
    approveAuthorization: createApproveAuthorization({ readAuthorization, codes, secrets, clock, issuer: ISSUER }),
    exchangeToken: createExchangeToken({ clients, codes, tokens: memoryIssuedTokens(), secrets, clock, resource: RESOURCE }),
  });
  await server.ready();
});

afterEach(async () => {
  await server.close();
});

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
  it.each(['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource'])('names its authorization server for the MCP endpoint at %s (RFC 9728)', async (path) => {
    const answer = await server.inject({ url: path });

    expect(answer.json()).toEqual({ resource: RESOURCE, authorization_servers: [ISSUER], bearer_methods_supported: ['header'] });
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
    const answer = await decide({ ...REQUEST, decision: 'approve' });

    expect(answer.statusCode).toBe(302);
    expect(String(answer.headers.location)).toBe(`${CALLBACK}?code=secret-1&state=state-1&iss=${encodeURIComponent(ISSUER)}`);
  });

  it('sends the client back with access_denied once argo denies', async () => {
    const answer = await decide({ ...REQUEST, decision: 'deny' });

    expect(new URL(String(answer.headers.location)).searchParams.get('error')).toBe('access_denied');
  });

  it('refuses a decision sent from another origin, or by a viewer', async () => {
    const answers = await Promise.all([decide({ ...REQUEST, decision: 'approve', origin: 'https://evil.example.com' }), decide({ ...REQUEST, decision: 'approve', cookie: VIEWER })]);

    expect(answers.map((answer) => answer.statusCode)).toEqual([403, 403]);
  });
});

describe('a client takes its code for tokens at /token', () => {
  it('answers the tokens as JSON, never cached, the client authenticated with HTTP Basic', async () => {
    await decide({ ...REQUEST, decision: 'approve' });

    const answer = await token({ grant_type: 'authorization_code', code: 'secret-1', redirect_uri: CALLBACK, code_verifier: 'verifier-1', resource: RESOURCE }, { authorization: `Basic ${Buffer.from(`${CLIENT}:cursor-secret`).toString('base64')}` });

    expect({ status: answer.statusCode, cache: answer.headers['cache-control'], body: tokenAnswer.safeParse(answer.json()).success }).toEqual({ status: 200, cache: 'no-store', body: true });
  });

  it('takes the client secret in the form too', async () => {
    await decide({ ...REQUEST, decision: 'approve' });

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
