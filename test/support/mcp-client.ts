/**
 * An outside MCP client in a test, as the MCP TypeScript SDK runs one: argo
 * pre-registers it, its party is crewed, a person of the fleet asks for
 * access for it at /authorize, signed in through a fake pagasae, and the
 * client signs in as its party.
 */
import { idSchema, type FleetId } from '@aeolus-fleet/common';
import { auth, type OAuthClientProvider, type StoredOAuthTokens } from '@modelcontextprotocol/client';
import { expect } from 'vitest';
import { z } from 'zod';

import { createPrismaClient } from '../../src/adapters/prisma/client.js';
import { createPrismaPendingRequests } from '../../src/adapters/prisma/pending-requests.js';
import { commission, register } from './argo.js';
import { aBrowser, pickedAt } from './browser.js';
import { charlotteIn, type FakePagasae } from './fake-pagasae.js';
import type { FleetServer } from './fleet-server.js';
import { connectGateway, mutate, query } from './gateway-api.js';
import { outsidePartiesOn } from './outside-parties.js';

/** The gateway secret every test gateway runs with. */
export const TEST_GATEWAY_SECRET = 'a-test-gateway-secret-of-at-least-32-characters';

export const CALLBACK = 'http://127.0.0.1:33418/callback';

/** The scopes argo commissions the gateway's ship with. */
const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify'];

/** The request a person opened for the test client, which argo approves. */
const APPROVAL_REQUEST_ID = 'req_01m5c7hmbt9f1vrkwb37az0009';

/** How long a pending request waits: 7 days (decision 0056). */
const REQUEST_LIFETIME_MS = 7 * 24 * 60 * 60_000;

/** Where a test's fleet, gateway and argo are. */
export interface Setting {
  fleet: FleetServer;
  address: string;
  cookie: string;
  databaseUrl: string;
  /** The pagasae the gateway signs people in through. */
  pagasae: FakePagasae;
}

const registered = z.object({ result: z.object({ data: z.object({ clientId: z.string(), clientSecret: z.string().nullable() }) }) });

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

/** argo connects the gateway to the fleet, as a person signs in only to a fleet the gateway serves. */
export async function aConnectedGateway(setting: Setting): Promise<void> {
  const gatewayShip = await commission(setting.fleet, { cookie: setting.cookie, ship: { name: 'gateway', type: 'gateway', kind: 'app', scopes: GATEWAY_SCOPES } });
  expect((await connectGateway(setting.address, { cookie: setting.cookie, ...gatewayShip })).status).toBe(200);
}

/** The fleet argo's console session is signed in to. */
export async function fleetIdOf(setting: Setting): Promise<FleetId> {
  const session = await fetch(`${setting.fleet.url}/trpc/console.session`, { headers: { cookie: setting.cookie } });
  return z.object({ result: z.object({ data: z.object({ fleetId: idSchema('fleet') }) }) }).parse(await session.json()).result.data.fleetId;
}

/** Charlotte asks for access for the client she was sent to authorize, whose party answers at once: the code the client gets back. */
export async function answered(setting: Setting, sentTo: URL): Promise<{ code: string; iss: string | null }> {
  setting.pagasae.answer(charlotteIn(setting.pagasae, await fleetIdOf(setting)));
  const answer = await aBrowser().follow(pickedAt(sentTo, 'party'), CALLBACK);
  const back = new URL(z.string().parse(answer.headers.get('location')));
  return { code: z.string().parse(back.searchParams.get('code')), iss: back.searchParams.get('iss') };
}

/**
 * The client's party, crewed by the gateway: a person asked for the client,
 * and an approver holding gateway:approve approved the request through the
 * gateway, which commissions and crews its proxy ship owned by the person
 * (aeolus-fleet#959).
 */
export async function aCrewedClientParty(setting: Setting, clientId: string): Promise<{ proxyShipId: string }> {
  const { fleet, cookie } = setting;
  const owner = await commission(fleet, { cookie, ship: { name: 'person-owner', type: 'person', kind: 'person' } });
  const approver = await register(fleet, await commission(fleet, { cookie, ship: { name: 'approver', type: 'agent', scopes: ['fleet:read', 'gateway:approve'] } }));
  const fleetId = await fleetIdOf(setting);
  await outsidePartiesOn(setting.databaseUrl, fleetId);
  const asked = new Date();
  const prisma = createPrismaClient(setting.databaseUrl);
  await createPrismaPendingRequests(prisma).open({
    fleetId,
    requestId: APPROVAL_REQUEST_ID,
    subject: { kind: 'client', clientId, clientName: 'Test client' },
    requesters: [{ accountId: 'acc-owner', personShipId: owner.shipId }],
    askedAt: asked,
    expiresAt: new Date(asked.getTime() + REQUEST_LIFETIME_MS),
    state: 'pending',
    decidedBy: null,
    decidedAt: null,
    now: asked,
  });
  await prisma.$disconnect();
  const decided = await mutate(setting.address, {
    procedure: 'requests.decide',
    crewToken: approver,
    body: { requestId: APPROVAL_REQUEST_ID, decision: { kind: 'approve', party: { name: 'test-client', ownerShipId: owner.shipId, scopes: ['messages:send', 'messages:receive'] } } },
  });
  expect(decided.status, await decided.clone().text()).toBe(200);
  const read = await query(setting.address, { procedure: 'parties.get', cookie, input: { name: 'test-client' } });
  return z.object({ result: z.object({ data: z.object({ proxyShipId: idSchema('ship') }) }) }).parse(await read.json()).result.data;
}

/** A client that signed in: its provider holds its tokens. */
export async function aSignedInClient(setting: Setting, isConfidential = true) {
  const information = await aRegisteredClient(setting, isConfidential);
  await aCrewedClientParty(setting, information.clientId);
  const client = aClientProvider(information);
  const serverUrl = `${setting.address}/mcp`;
  await auth(client.provider, { serverUrl });
  const { code, iss } = await answered(setting, z.instanceof(URL).parse(client.sentTo()));
  await auth(client.provider, { serverUrl, authorizationCode: code, ...(iss === null ? {} : { iss }) });
  return client;
}
