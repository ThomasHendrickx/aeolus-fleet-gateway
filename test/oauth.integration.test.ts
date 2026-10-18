import { auth, type OAuthClientProvider, type StoredOAuthTokens } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { aFreePort, startFleetServer, type FleetServer } from './support/fleet-server.js';
import { mutate } from './support/gateway-api.js';

// An MCP client signs in to the gateway with the MCP TypeScript SDK, as
// Claude or Cursor would: argo pre-registers it, approves it at /authorize
// with a real console session, and the client takes its code for tokens.

const CALLBACK = 'http://127.0.0.1:33418/callback';

let fleet: FleetServer;
let app: GatewayApp;
let address: string;
let cookie: string;

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  cookie = await signIn(fleet);
  const port = await aFreePort();
  address = `http://127.0.0.1:${String(port)}`;
  app = createGatewayApp({ databaseUrl: await migratedDatabase(inject('postgresUrl')), fleetUrl: fleet.url, logger: false, publicUrl: address });
  await app.server.listen({ host: '127.0.0.1', port });
});

afterEach(async () => {
  await app.close();
  await fleet.stop();
});

const registered = z.object({ result: z.object({ data: z.object({ clientId: z.string(), clientSecret: z.string().nullable() }) }) });

/** An SDK client provider for a pre-registered client: argo approves wherever it is sent to authorize. */
function aClient(client: { clientId: string; clientSecret: string | null }) {
  let verifier = '';
  let saved: StoredOAuthTokens | undefined;
  let sentTo: URL | undefined;
  const provider: OAuthClientProvider = {
    redirectUrl: CALLBACK,
    clientMetadata: { client_name: 'Test client', redirect_uris: [CALLBACK] },
    clientInformation: () => ({ client_id: client.clientId, ...(client.clientSecret === null ? {} : { client_secret: client.clientSecret }) }),
    tokens: () => saved,
    saveTokens: (tokens) => {
      saved = tokens;
    },
    redirectToAuthorization: (url) => {
      sentTo = url;
    },
    saveCodeVerifier: (codeVerifier) => {
      verifier = codeVerifier;
    },
    codeVerifier: () => verifier,
  };
  return { provider, sentTo: () => sentTo, tokens: () => saved };
}

/** argo approves the request the client was sent to authorize: the code the client gets back. */
async function approved(sentTo: URL): Promise<{ code: string; iss: string | null }> {
  const page = await fetch(sentTo, { headers: { cookie } });
  expect(page.status).toBe(200);
  const answer = await fetch(`${address}/authorize`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, origin: address, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...Object.fromEntries(sentTo.searchParams), decision: 'approve' }).toString(),
  });
  const back = new URL(z.string().parse(answer.headers.get('location')));
  return { code: z.string().parse(back.searchParams.get('code')), iss: back.searchParams.get('iss') };
}

describe('an MCP client signs in to the gateway with the MCP TypeScript SDK', () => {
  it.each([
    ['a confidential client', true],
    ['a public client', false],
  ])('%s gets tokens once argo approves it', async (_what, isConfidential) => {
    const response = await mutate(address, { procedure: 'oauth.registerClient', cookie, body: { name: 'Test client', redirectUris: [CALLBACK], isConfidential } });
    const client = aClient(registered.parse(await response.json()).result.data);
    const serverUrl = `${address}/mcp`;

    await expect(auth(client.provider, { serverUrl })).resolves.toBe('REDIRECT');
    const { code, iss } = await approved(z.instanceof(URL).parse(client.sentTo()));
    await expect(auth(client.provider, { serverUrl, authorizationCode: code, ...(iss === null ? {} : { iss }) })).resolves.toBe('AUTHORIZED');

    expect(client.tokens()).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });
  });
});
