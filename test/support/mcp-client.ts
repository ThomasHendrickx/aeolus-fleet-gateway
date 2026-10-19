/**
 * An outside MCP client in a test, as the MCP TypeScript SDK runs one: argo
 * pre-registers it, its party is crewed, argo approves it at /authorize with
 * a real console session, and it signs in.
 */
import { idSchema, type FleetId } from '@aeolus-fleet/common';
import { auth, type OAuthClientProvider, type StoredOAuthTokens } from '@modelcontextprotocol/client';
import { expect } from 'vitest';
import { z } from 'zod';

import { createPrismaClient } from '../../src/adapters/prisma/client.js';
import { createPrismaConnectionStore } from '../../src/adapters/prisma/connection-store.js';
import { createPrismaPartyStore } from '../../src/adapters/prisma/party-store.js';
import { commission, register } from './argo.js';
import type { FleetServer } from './fleet-server.js';
import { mutate, query } from './gateway-api.js';

/** The gateway secret every test gateway runs with. */
export const TEST_GATEWAY_SECRET = 'a-test-gateway-secret-of-at-least-32-characters';

export const CALLBACK = 'http://127.0.0.1:33418/callback';

/** Where a test's fleet, gateway and argo are. */
export interface Setting {
  fleet: FleetServer;
  address: string;
  cookie: string;
  databaseUrl: string;
}

const registered = z.object({ result: z.object({ data: z.object({ clientId: z.string(), clientSecret: z.string().nullable() }) }) });

/** The fleet's MCP endpoint, as argo reads it: where its MCP clients connect. */
export async function mcpEndpointOf(setting: Setting): Promise<string> {
  const response = await query(setting.address, { procedure: 'mcp.endpoint', cookie: setting.cookie });
  return z.object({ result: z.object({ data: z.string() }) }).parse(await response.json()).result.data;
}

/** argo pre-registers a client: its id, and its secret when confidential. */
export async function aRegisteredClient(setting: Setting, isConfidential: boolean): Promise<{ clientId: string; clientSecret: string | null }> {
  const response = await mutate(setting.address, { procedure: 'oauth.registerClient', cookie: setting.cookie, body: { name: 'Test client', redirectUris: [CALLBACK], isConfidential } });
  return registered.parse(await response.json()).result.data;
}

/** An SDK client provider for a pre-registered client: argo approves wherever it is sent to authorize. */
export function aClientProvider(client: { clientId: string; clientSecret: string | null }) {
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
export async function approved(setting: Setting, sentTo: URL): Promise<{ code: string; iss: string | null }> {
  const page = await fetch(sentTo, { headers: { cookie: setting.cookie } });
  expect(page.status).toBe(200);
  const answer = await fetch(`${setting.address}/authorize`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: setting.cookie, origin: setting.address, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...Object.fromEntries(sentTo.searchParams), decision: 'approve' }).toString(),
  });
  const back = new URL(z.string().parse(answer.headers.get('location')));
  return { code: z.string().parse(back.searchParams.get('code')), iss: back.searchParams.get('iss') };
}

/**
 * The client's party, crewed by the gateway: what 0.28's commission at its
 * first approval leaves, made with 0.27's doors. Core 0.27 commissions no app
 * ship for the gateway (aeolus-fleet#959), so argo commissions the proxy
 * ship in the console, the party is kept awaiting crew as the gateway's
 * commission leaves it, and argo hands its secret over with parties.crew.
 */
/**
 * The gateway connected to the test's fleet, as connection.connect leaves it:
 * its ship's crew token, without the networking plugin connect checks for.
 * The fleet's MCP endpoint is served from then on. Its fleet.
 */
export async function aConnectedGateway(setting: Setting): Promise<FleetId> {
  const { fleet, cookie } = setting;
  const gateway = await commission(fleet, { cookie, ship: { name: 'gateway', type: 'gateway' } });
  const crewToken = await register(fleet, gateway);
  const whoami = await fetch(`${fleet.url}/api/v1/ship/whoami`, { headers: { authorization: `Bearer ${crewToken}` } });
  const { fleetId } = z.object({ fleetId: idSchema('fleet') }).parse(await whoami.json());
  const prisma = createPrismaClient(setting.databaseUrl);
  await createPrismaConnectionStore(prisma).save({ fleetId, shipId: gateway.shipId, name: 'gateway', crewToken, crewedAt: new Date() });
  await prisma.$disconnect();
  return fleetId;
}

export async function aCrewedClientParty(setting: Setting, clientId: string): Promise<{ proxyShipId: string }> {
  const { fleet, cookie } = setting;
  const fleetId = await aConnectedGateway(setting);
  const proxy = await commission(fleet, { cookie, ship: { name: 'test-client', type: 'mcp-client', kind: 'app' } });
  const owner = await commission(fleet, { cookie, ship: { name: 'owner', type: 'agent' } });
  const prisma = createPrismaClient(setting.databaseUrl);
  await createPrismaPartyStore(prisma).save({
    fleetId,
    name: 'test-client',
    kind: 'mcpClient',
    clientId,
    // The owner is only kept by the gateway; core 0.28 checks it at the commission.
    ownerShipId: owner.shipId,
    state: 'awaitingCrew',
    proxyShipId: proxy.shipId,
    secret: null,
    crewToken: null,
    requestId: 'approve-test-client',
    requestHash: 'h',
    approvedAt: new Date(),
  });
  await prisma.$disconnect();
  const crewed = await mutate(setting.address, { procedure: 'parties.crew', cookie, body: { name: 'test-client', secret: proxy.secret } });
  expect(crewed.status).toBe(200);
  return { proxyShipId: proxy.shipId };
}

/** A client that signed in: its provider holds its tokens. */
export async function aSignedInClient(setting: Setting, isConfidential = true) {
  const information = await aRegisteredClient(setting, isConfidential);
  await aCrewedClientParty(setting, information.clientId);
  const client = aClientProvider(information);
  const serverUrl = await mcpEndpointOf(setting);
  await auth(client.provider, { serverUrl });
  const { code, iss } = await approved(setting, z.instanceof(URL).parse(client.sentTo()));
  await auth(client.provider, { serverUrl, authorizationCode: code, ...(iss === null ? {} : { iss }) });
  return { ...client, endpoint: serverUrl };
}
