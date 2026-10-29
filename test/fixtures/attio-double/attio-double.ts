/**
 * An outside MCP server that takes only an OAuth sign-in, shaped as Attio's
 * (oauth-servers L10), on a free local port: its MCP endpoint answers 401
 * naming its protected resource metadata (RFC 9728), which names its
 * authorization server, whose metadata (RFC 8414) offers dynamic
 * registration (RFC 7591) and PKCE S256, with the scopes mcp, offline_access
 * and openid. It keeps every client it registered, so a test sees how many.
 * Its authorize address signs in, at once, the outside account the test
 * names, or denies consent; its token endpoint redeems each code once for
 * the client that asked it, with the PKCE verifier of its challenge and the
 * MCP endpoint as resource, answering an unsigned ID token; it revokes
 * tokens where the test offers revocation. It refreshes a grant by its
 * refresh token, rotating it. Its MCP endpoint lists and runs
 * search_records under an access token it issued and did not revoke or
 * end, recording each one it was called with and the outside account each
 * call ran as; it refuses the tools the test names 403 `insufficient_scope`.
 */
import { createHash } from 'node:crypto';

import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import Fastify, { type FastifyRequest } from 'fastify';
import { z } from 'zod';

const HTTP_UNAUTHORIZED = 401;
const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const HTTP_FOUND = 302;
const HTTP_FORBIDDEN = 403;
const HTTP_UNAVAILABLE = 503;
const SCOPES = ['mcp', 'offline_access', 'openid'];
const ACCESS_TOKEN_LIFETIME_SECONDS = 3600;

export interface AttioDoubleOptions {
  /** The PKCE methods its authorization server states; S256 by default. */
  codeChallengeMethods?: string[];
  /** Whether its authorization server offers dynamic registration; it does by default. */
  isRegistering?: boolean;
  /** Whether its authorization server offers revocation (RFC 7009); as Attio's, it does not by default. */
  isRevoking?: boolean;
  /** Whether its authorization server states its issuer in each authorization response (RFC 9207); as Attio's, it does not by default. */
  isIssuerInResponse?: boolean;
}

export interface RegisteredClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  scope: string | undefined;
}

/** The outside account the authorize address signs in next, or a denied consent. */
export type AttioSignIn = { subject: string; email: string } | 'denied';

export interface AttioDouble {
  /** Its MCP endpoint. */
  url: string;
  /** Its authorization server's issuer. */
  issuer: string;
  registered: RegisteredClient[];
  /** Who the authorize address signs in from now on. */
  signIn: AttioSignIn;
  /** Every token revoked, in order. */
  revoked: string[];
  /** The Authorization header of each request to its MCP endpoint that it served. */
  authorizations: string[];
  /** The outside account, by subject, each tool call ran as, in order. */
  calledAs: string[];
  /** The refresh tokens it refreshed a grant with, in order. */
  refreshed: string[];
  /** Ends every access token issued so far, as their lifetime passing does: the MCP endpoint refuses them 401. */
  endAccessTokens(): void;
  /** Spends every refresh token issued so far, as a refresh whose rotated token never reached the gateway does: each is refused invalid_grant from now on. */
  spendRefreshTokens(): void;
  /** While true, its token endpoint answers 503, as an authorization server that is down does. */
  isTokenEndpointDown: boolean;
  /** How many token requests it answered 503 while down. */
  tokenRequestsWhileDown: number;
  /** Whether the MCP endpoint refuses every access token 401, a refreshed one too. */
  isRefusingEveryAccessToken: boolean;
  /** The tools whose call it refuses 403 `insufficient_scope`. */
  insufficientScopeTools: string[];
  /** While true, search_records runs and never answers: a call the gateway sent and gets no answer to. */
  isHoldingCalls: boolean;
  close(): Promise<void>;
}

const registrationSchema = z.object({ client_name: z.string(), redirect_uris: z.array(z.string()).min(1), scope: z.string().optional() });
const authorizeSchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string(),
  redirect_uri: z.string(),
  state: z.string(),
  code_challenge: z.string(),
  code_challenge_method: z.literal('S256'),
  resource: z.string(),
  scope: z.string(),
});
const redeemSchema = z.object({ grant_type: z.literal('authorization_code'), code: z.string(), redirect_uri: z.string(), client_id: z.string(), client_secret: z.string(), code_verifier: z.string(), resource: z.string() });
const refreshSchema = z.object({ grant_type: z.literal('refresh_token'), refresh_token: z.string(), client_id: z.string(), client_secret: z.string(), resource: z.string() });
const toolCallSchema = z.object({ method: z.literal('tools/call'), params: z.object({ name: z.string() }) });
const revokeSchema = z.object({ token: z.string(), client_id: z.string(), client_secret: z.string() });

interface IssuedCode {
  clientId: string;
  redirectUri: string;
  challenge: string;
  account: { subject: string; email: string };
}

function unsignedJwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none', typ: 'JWT' })}.${part(claims)}.`;
}

function attioServer(double: AttioDouble): McpServer {
  const mcp = new McpServer({ name: 'attio-double', version: '1.0.0' }, { capabilities: { tools: {} } });
  mcp.registerTool('search_records', { description: 'Search records in the workspace', inputSchema: z.object({ query: z.string() }), annotations: { readOnlyHint: true } }, async ({ query }) => {
    if (double.isHoldingCalls) {
      await new Promise<never>(() => undefined);
    }
    return { content: [{ type: 'text', text: `records for ${query}` }] };
  });
  return mcp;
}

/** The request as the SDK's web-standard handler takes it. Fastify has read the JSON body already. */
function webRequestOf(request: FastifyRequest): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    for (const each of Array.isArray(value) ? value : [value]) {
      if (each !== undefined) {
        headers.append(name, each);
      }
    }
  }
  return new Request(new URL(request.url, `${request.protocol}://${request.host}`), { method: request.method, headers });
}

export async function startAttioDouble(options: AttioDoubleOptions = {}): Promise<AttioDouble> {
  const server = Fastify();
  // Fastify's parser callback takes the request, the body and done: three parameters, its own shape.
  // eslint-disable-next-line @typescript-eslint/max-params
  server.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(typeof body === 'string' ? body : body.toString())));
  });
  const registered: RegisteredClient[] = [];
  const codes = new Map<string, IssuedCode>();
  /** The outside account each live access token and refresh token is for, by subject, with the client it was issued to. */
  const accessTokens = new Map<string, string>();
  const refreshTokens = new Map<string, { clientId: string; subject: string; email: string }>();
  let issued = 0;
  let origin = '';
  const double: AttioDouble = {
    url: '',
    issuer: '',
    registered,
    signIn: { subject: 'attio-member-mathilde', email: 'mathilde@acme.example' },
    revoked: [],
    authorizations: [],
    calledAs: [],
    refreshed: [],
    endAccessTokens: () => {
      accessTokens.clear();
    },
    spendRefreshTokens: () => {
      refreshTokens.clear();
    },
    isTokenEndpointDown: false,
    tokenRequestsWhileDown: 0,
    isRefusingEveryAccessToken: false,
    insufficientScopeTools: [],
    isHoldingCalls: false,
    close: () => server.close(),
  };
  const secretOf = (clientId: string) => `${clientId}-secret`;

  server.all('/mcp', async (request, reply) => {
    const authorization = request.headers.authorization ?? '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    const subject = accessTokens.get(token);
    if (subject === undefined || double.revoked.includes(token) || double.isRefusingEveryAccessToken) {
      return reply.code(HTTP_UNAUTHORIZED).header('www-authenticate', `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`).send({ error: 'invalid_token' });
    }
    const called = toolCallSchema.safeParse(request.body);
    if (called.success && double.insufficientScopeTools.includes(called.data.params.name)) {
      return reply.code(HTTP_FORBIDDEN).header('www-authenticate', 'Bearer error="insufficient_scope", scope="mcp records:write"').send({ error: 'insufficient_scope' });
    }
    double.authorizations.push(authorization);
    if (called.success) {
      double.calledAs.push(subject);
    }
    return createMcpHandler(() => attioServer(double)).fetch(webRequestOf(request), { parsedBody: request.body });
  });
  server.get('/.well-known/oauth-protected-resource/mcp', () => ({ resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: SCOPES, bearer_methods_supported: ['header'] }));
  server.get('/.well-known/oauth-authorization-server', () => ({
    issuer: origin,
    authorization_endpoint: `${origin}/oidc/authorize`,
    token_endpoint: `${origin}/oidc/token`,
    ...(options.isRegistering === false ? {} : { registration_endpoint: `${origin}/oauth/register` }),
    ...(options.isRevoking === true ? { revocation_endpoint: `${origin}/oidc/revoke` } : {}),
    ...(options.isIssuerInResponse === true ? { authorization_response_iss_parameter_supported: true } : {}),
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: options.codeChallengeMethods ?? ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    scopes_supported: SCOPES,
  }));
  server.post('/oauth/register', (request, reply) => {
    const asked = registrationSchema.safeParse(request.body);
    if (!asked.success) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: 'invalid_client_metadata', error_description: asked.error.message });
    }
    const clientId = `attio-client-${String(registered.length + 1)}`;
    registered.push({ clientId, clientName: asked.data.client_name, redirectUris: asked.data.redirect_uris, scope: asked.data.scope });
    return reply.code(HTTP_CREATED).send({ client_id: clientId, client_secret: secretOf(clientId), ...asked.data, token_endpoint_auth_method: 'client_secret_post' });
  });
  server.get('/oidc/authorize', (request, reply) => {
    const asked = authorizeSchema.safeParse(request.query);
    const client = asked.success ? registered.find(({ clientId }) => clientId === asked.data.client_id) : undefined;
    if (!asked.success || client === undefined || !client.redirectUris.includes(asked.data.redirect_uri) || asked.data.resource !== double.url) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: 'invalid_request' });
    }
    const back = new URL(asked.data.redirect_uri);
    back.searchParams.set('state', asked.data.state);
    if (options.isIssuerInResponse === true) {
      back.searchParams.set('iss', origin);
    }
    if (double.signIn === 'denied') {
      back.searchParams.set('error', 'access_denied');
    } else {
      issued += 1;
      const code = `attio-code-${String(issued)}`;
      codes.set(code, { clientId: client.clientId, redirectUri: asked.data.redirect_uri, challenge: asked.data.code_challenge, account: double.signIn });
      back.searchParams.set('code', code);
    }
    return reply.code(HTTP_FOUND).header('location', back.toString()).send();
  });
  const issueTokens = (clientId: string, account: { subject: string; email: string }) => {
    issued += 1;
    const accessToken = `attio-access-${String(issued)}`;
    const refreshToken = `attio-refresh-${String(issued)}`;
    accessTokens.set(accessToken, account.subject);
    refreshTokens.set(refreshToken, { clientId, ...account });
    return { access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TOKEN_LIFETIME_SECONDS, refresh_token: refreshToken };
  };
  server.post('/oidc/token', (request, reply) => {
    if (double.isTokenEndpointDown) {
      double.tokenRequestsWhileDown += 1;
      return reply.code(HTTP_UNAVAILABLE).send();
    }
    const refreshing = refreshSchema.safeParse(request.body);
    if (refreshing.success) {
      const { refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, resource } = refreshing.data;
      const grant = refreshTokens.get(refreshToken);
      if (grant?.clientId !== clientId || clientSecret !== secretOf(clientId) || resource !== double.url || double.revoked.includes(refreshToken)) {
        return reply.code(HTTP_BAD_REQUEST).send({ error: 'invalid_grant', error_description: 'The refresh token is unknown, used or not this client\'s' });
      }
      // Rotated: the refresh token used is never taken again.
      refreshTokens.delete(refreshToken);
      double.refreshed.push(refreshToken);
      return reply.send(issueTokens(clientId, grant));
    }
    const asked = redeemSchema.safeParse(request.body);
    const code = asked.success ? codes.get(asked.data.code) : undefined;
    if (!asked.success || code === undefined) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: 'invalid_grant', error_description: 'The code is unknown or used' });
    }
    codes.delete(asked.data.code);
    const { client_id: clientId, client_secret: clientSecret, code_verifier: verifier, redirect_uri: redirectUri, resource } = asked.data;
    if (clientId !== code.clientId || clientSecret !== secretOf(clientId) || redirectUri !== code.redirectUri || createHash('sha256').update(verifier).digest('base64url') !== code.challenge || resource !== double.url) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: 'invalid_grant', error_description: 'The code was not issued for this client, verifier or resource' });
    }
    return reply.send({ ...issueTokens(clientId, code.account), id_token: unsignedJwt({ iss: origin, aud: clientId, sub: code.account.subject, email: code.account.email }) });
  });
  server.post('/oidc/revoke', (request, reply) => {
    const asked = revokeSchema.safeParse(request.body);
    if (options.isRevoking !== true || !asked.success || asked.data.client_secret !== secretOf(asked.data.client_id)) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: 'invalid_request' });
    }
    double.revoked.push(asked.data.token);
    return reply.send();
  });
  origin = (await server.listen({ host: '127.0.0.1', port: 0 })).replace('[::1]', '127.0.0.1');
  double.url = `${origin}/mcp`;
  double.issuer = origin;
  return double;
}
