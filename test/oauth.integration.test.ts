import { auth, type OAuthClientProvider, type StoredOAuthTokens } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { idSchema } from '@aeolus-fleet/common';

import { createPrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaPartyStore } from '../src/adapters/prisma/party-store.js';
import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { commission, register, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { aFreePort, startFleetServer, type FleetServer } from './support/fleet-server.js';
import { mutate } from './support/gateway-api.js';

// An MCP client signs in to the gateway with the MCP TypeScript SDK, as
// Claude or Cursor would: argo pre-registers it, approves it at /authorize
// with a real console session, and the client takes its code for tokens.
// Core 0.27 commissions no app ship for the gateway (aeolus-fleet#959), so
// argo commissions the client's proxy ship in the console, the party is kept
// awaiting crew as the gateway's commission leaves it, and argo hands its
// secret over with parties.crew; the approval then takes that party.

const CALLBACK = 'http://127.0.0.1:33418/callback';

let fleet: FleetServer;
let app: GatewayApp;
let address: string;
let cookie: string;
let databaseUrl: string;

beforeEach(async () => {
  fleet = await startFleetServer(inject('postgresUrl'));
  cookie = await signIn(fleet);
  const port = await aFreePort();
  address = `http://127.0.0.1:${String(port)}`;
  databaseUrl = await migratedDatabase(inject('postgresUrl'));
  app = createGatewayApp({ databaseUrl, fleetUrl: fleet.url, logger: false, publicUrl: address });
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

/** The client's party, crewed by the gateway: what 0.28's commission at its first approval leaves, made with 0.27's doors. */
async function aCrewedParty(clientId: string): Promise<void> {
  const proxy = await commission(fleet, { cookie, ship: { name: 'test-client', type: 'mcp-client', kind: 'app' } });
  const agent = await commission(fleet, { cookie, ship: { name: 'owner', type: 'agent' } });
  const whoami = await fetch(`${fleet.url}/api/v1/ship/whoami`, { headers: { authorization: `Bearer ${await register(fleet, agent)}` } });
  const { fleetId } = z.object({ fleetId: idSchema('fleet') }).parse(await whoami.json());
  const prisma = createPrismaClient(databaseUrl);
  await createPrismaPartyStore(prisma).save({
    fleetId,
    name: 'test-client',
    kind: 'mcpClient',
    clientId,
    // The owner is only kept by the gateway; core 0.28 checks it at the commission.
    ownerShipId: agent.shipId,
    state: 'awaitingCrew',
    proxyShipId: proxy.shipId,
    secret: null,
    crewToken: null,
    requestId: 'approve-test-client',
    requestHash: 'h',
    approvedAt: new Date(),
  });
  await prisma.$disconnect();
  const crewed = await mutate(address, { procedure: 'parties.crew', cookie, body: { name: 'test-client', secret: proxy.secret } });
  expect(crewed.status).toBe(200);
}

describe('an MCP client signs in to the gateway with the MCP TypeScript SDK', () => {
  it.each([
    ['a confidential client', true],
    ['a public client', false],
  ])('%s gets tokens once argo approves it', async (_what, isConfidential) => {
    const response = await mutate(address, { procedure: 'oauth.registerClient', cookie, body: { name: 'Test client', redirectUris: [CALLBACK], isConfidential } });
    const information = registered.parse(await response.json()).result.data;
    await aCrewedParty(information.clientId);
    const client = aClient(information);
    const serverUrl = `${address}/mcp`;

    await expect(auth(client.provider, { serverUrl })).resolves.toBe('REDIRECT');
    const { code, iss } = await approved(z.instanceof(URL).parse(client.sentTo()));
    await expect(auth(client.provider, { serverUrl, authorizationCode: code, ...(iss === null ? {} : { iss }) })).resolves.toBe('AUTHORIZED');

    expect(client.tokens()).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });
  });
});
