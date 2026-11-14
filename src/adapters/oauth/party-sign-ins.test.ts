import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ATTIO_CLIENT } from '../../../test/support/party-grant-fakes.js';
import { createPartySignIns } from './party-sign-ins.js';

let server: Server;
let endpoint: string;
let requests: { authorization: string | undefined; form: Record<string, string> }[];
beforeEach(async () => {
  requests = [];
  async function respond(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    requests.push({ authorization: request.headers.authorization, form: Object.fromEntries(new URLSearchParams(body)) });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ access_token: 'access', token_type: 'Bearer' }));
  }
  server = createServer((request, response) => { void respond(request, response); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No listening port');
  endpoint = `http://127.0.0.1:${String(address.port)}`;
});
afterEach(() => new Promise<void>((resolve, reject) => server.close((error) => { if (error === undefined) { resolve(); } else { reject(error); } })));

describe('stored outside client authentication', () => {
  it.each(['none', 'client_secret_post', 'client_secret_basic'] as const)('uses %s for code redemption, refresh and revocation', async (tokenEndpointAuthMethod) => {
    const client = { ...ATTIO_CLIENT, clientId: 'a :+é', clientSecret: tokenEndpointAuthMethod === 'none' ? null : 's :+é', tokenEndpointAuthMethod, tokenEndpoint: endpoint, revocationEndpoint: endpoint, revocationEndpointAuthMethods: [tokenEndpointAuthMethod] };
    const signIns = createPartySignIns();
    expect((await signIns.redeemCode(client, { code: 'code', verifier: 'verifier', redirectUri: 'https://gateway.test/done' })).isOk).toBe(true);
    expect((await signIns.refresh(client, 'refresh')).isOk).toBe(true);
    expect((await signIns.revoke(client, 'refresh')).isOk).toBe(true);
    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.authorization).toBe(tokenEndpointAuthMethod === 'client_secret_basic' ? 'Basic YSslM0ElMkIlQzMlQTk6cyslM0ElMkIlQzMlQTk=' : undefined);
      expect(request.form.client_secret).toBe(tokenEndpointAuthMethod === 'client_secret_post' ? 's :+é' : undefined);
      expect(request.form.client_id).toBe(tokenEndpointAuthMethod === 'client_secret_basic' ? undefined : 'a :+é');
    }
    expect(requests[0]?.form).toMatchObject({ resource: ATTIO_CLIENT.resource, code_verifier: 'verifier' });
    expect(requests[1]?.form).toMatchObject({ resource: ATTIO_CLIENT.resource, refresh_token: 'refresh' });
  });

  it('refuses revocation when its advertised methods exclude the stored method without sending credentials', async () => {
    const client = { ...ATTIO_CLIENT, revocationEndpoint: endpoint, revocationEndpointAuthMethods: ['client_secret_basic'] };
    expect((await createPartySignIns().revoke(client, 'refresh')).isOk).toBe(false);
    expect(requests).toEqual([]);
  });
});
