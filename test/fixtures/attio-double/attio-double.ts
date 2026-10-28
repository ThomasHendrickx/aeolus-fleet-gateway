/**
 * An outside MCP server that takes only an OAuth sign-in, shaped as Attio's
 * (oauth-servers L10), on a free local port: its MCP endpoint answers 401
 * naming its protected resource metadata (RFC 9728), which names its
 * authorization server, whose metadata (RFC 8414) offers dynamic
 * registration (RFC 7591) and PKCE S256, with the scopes mcp, offline_access
 * and openid. It keeps every client it registered, so a test sees how many.
 */
import Fastify from 'fastify';
import { z } from 'zod';

const HTTP_UNAUTHORIZED = 401;
const HTTP_CREATED = 201;
const HTTP_BAD_REQUEST = 400;
const SCOPES = ['mcp', 'offline_access', 'openid'];

export interface AttioDoubleOptions {
  /** The PKCE methods its authorization server states; S256 by default. */
  codeChallengeMethods?: string[];
  /** Whether its authorization server offers dynamic registration; it does by default. */
  isRegistering?: boolean;
}

export interface RegisteredClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  scope: string | undefined;
}

export interface AttioDouble {
  /** Its MCP endpoint. */
  url: string;
  /** Its authorization server's issuer. */
  issuer: string;
  registered: RegisteredClient[];
  close(): Promise<void>;
}

const registrationSchema = z.object({ client_name: z.string(), redirect_uris: z.array(z.string()).min(1), scope: z.string().optional() });

export async function startAttioDouble(options: AttioDoubleOptions = {}): Promise<AttioDouble> {
  const server = Fastify();
  const registered: RegisteredClient[] = [];
  let origin = '';
  server.post('/mcp', (_request, reply) =>
    reply.code(HTTP_UNAUTHORIZED).header('www-authenticate', `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`).send({ error: 'invalid_token' }),
  );
  server.get('/.well-known/oauth-protected-resource/mcp', () => ({ resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: SCOPES, bearer_methods_supported: ['header'] }));
  server.get('/.well-known/oauth-authorization-server', () => ({
    issuer: origin,
    authorization_endpoint: `${origin}/oidc/authorize`,
    token_endpoint: `${origin}/oidc/token`,
    ...(options.isRegistering === false ? {} : { registration_endpoint: `${origin}/oauth/register` }),
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
    return reply.code(HTTP_CREATED).send({ client_id: clientId, client_secret: `${clientId}-secret`, ...asked.data, token_endpoint_auth_method: 'client_secret_post' });
  });
  origin = (await server.listen({ host: '127.0.0.1', port: 0 })).replace('[::1]', '127.0.0.1');
  return { url: `${origin}/mcp`, issuer: origin, registered, close: () => server.close() };
}
