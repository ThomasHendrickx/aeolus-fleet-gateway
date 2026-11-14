import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAuthorizationServers } from './authorization-servers.js';

let server: Server;
let origin: string;
let metadata: Record<string, unknown>;
let registration: Record<string, unknown>;
beforeEach(async () => {
  metadata = {};
  registration = { client_id: 'client', client_secret: 'secret' };
  server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/mcp') {
      response.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${origin}/resource"` });
      response.end();
    } else if (request.url === '/resource') {
      response.end(JSON.stringify({ resource: `${origin}/mcp`, authorization_servers: [origin] }));
    } else if (request.url === '/register') {
      response.end(JSON.stringify(registration));
    } else {
      response.end(JSON.stringify({ issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, response_types_supported: ['code'], ...metadata }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No listening port');
  origin = `http://127.0.0.1:${String(address.port)}`;
});
afterEach(() => new Promise<void>((resolve, reject) => server.close((error) => { if (error === undefined) { resolve(); } else { reject(error); } })));

describe('outside authorization server capabilities', () => {
  it('applies Basic metadata defaults and carries CIMD and revocation capabilities', async () => {
    metadata = { client_id_metadata_document_supported: true, revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post'] };
    expect(await createAuthorizationServers().discover(`${origin}/mcp`)).toMatchObject({ isOk: true, value: { tokenEndpointAuthMethods: ['client_secret_basic'], revocationEndpointAuthMethods: ['none', 'client_secret_post'], isClientIdMetadataDocumentSupported: true } });
  });

  it.each(['none', 'client_secret_post', 'client_secret_basic'] as const)('carries the advertised %s token method', async (method) => {
    metadata = { token_endpoint_auth_methods_supported: [method] };
    expect(await createAuthorizationServers().discover(`${origin}/mcp`)).toMatchObject({ isOk: true, value: { tokenEndpointAuthMethods: [method], revocationEndpointAuthMethods: ['client_secret_basic'], isClientIdMetadataDocumentSupported: false } });
  });

  it('refuses malformed revocation capabilities as invalid metadata', async () => {
    metadata = { revocation_endpoint_auth_methods_supported: 'client_secret_post' };
    await expect(createAuthorizationServers().discover(`${origin}/mcp`)).resolves.toMatchObject({ isOk: false, error: { kind: 'noServerMetadata' } });
  });

  it('applies the registration Basic default when the response omits the method', async () => {
    expect(await createAuthorizationServers().register(`${origin}/register`, { clientName: 'client', redirectUri: 'https://gateway.test/done', scope: 'mcp' })).toMatchObject({ isOk: true, value: { tokenEndpointAuthMethod: 'client_secret_basic' } });
  });

  it.each([
    { token_endpoint_auth_method: 'private_key_jwt' },
    { token_endpoint_auth_method: 'client_secret_post', client_secret: undefined },
    { token_endpoint_auth_method: 'none', client_secret: 'unexpected' },
  ])('refuses an unusable registration response %j', async (fields) => {
    registration = { client_id: 'client', ...fields };
    expect(await createAuthorizationServers().register(`${origin}/register`, { clientName: 'client', redirectUri: 'https://gateway.test/done', scope: 'mcp' })).toMatchObject({ isOk: false });
  });
});
