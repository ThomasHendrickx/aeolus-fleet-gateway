import { createHash } from 'node:crypto';

import { QUESTION_CONTENT_TYPE, type FleetId } from '@aeolus-fleet/common';
import { auth, Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createProviderDiscovery } from '../src/adapters/oidc/provider-discovery.js';
import { createProviderSignIn } from '../src/adapters/oidc/provider-sign-in.js';
import { createPrismaSignIns } from '../src/adapters/prisma/sign-ins.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFleetForgetter } from '../src/adapters/prisma/fleet-forgetter.js';
import { createPrismaIdentityProviders } from '../src/adapters/prisma/identity-providers.js';
import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { commission, register, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { send } from './support/ship.js';
import { aFreePort, startFleetServer, type FleetServer } from './support/fleet-server.js';
import { mutate, query } from './support/gateway-api.js';
import { aClientProvider, aConnectedGateway, aRegisteredClient, CALLBACK, mcpEndpointOf, TEST_GATEWAY_SECRET } from './support/mcp-client.js';
import { CHARLOTTE, PROVIDER_CLIENT_ID, startOidcProvider, type OidcProvider } from './support/oidc-provider.js';

// Federation for people (interop I-4): argo sets the fleet's company identity
// provider, which a local OpenID provider stands in for here.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const AT = new Date('2026-10-19T12:00:00.000Z');

let provider: OidcProvider;

beforeAll(async () => {
  provider = await startOidcProvider();
});

afterAll(async () => {
  await provider.stop();
});

describe("the gateway reads an identity provider's OpenID configuration", () => {
  const discovery = createProviderDiscovery({ timeoutMs: 5000 });

  it('reads its issuer, authorization and token endpoints, and keys', async () => {
    const issuer = provider.issuerOf('company');

    await expect(discovery.discover(issuer)).resolves.toEqual({
      isOk: true,
      value: { issuer, authorizationEndpoint: `${issuer}/authorize`, tokenEndpoint: `${issuer}/token`, jwksUri: `${issuer}/jwks` },
    });
  });

  it('cannot read one where nothing answers, saying why', async () => {
    const discovered = await discovery.discover(`http://127.0.0.1:${String(await aFreePort())}/company`);

    expect(discovered.isOk ? '' : discovered.error.reason).not.toBe('');
  });
});

describe("the fleets' identity providers in Postgres", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps one per fleet, the last argo set, with its secret", async () => {
    const providers = createPrismaIdentityProviders(prisma);
    await providers.save({ fleetId: FLEET, issuer: 'https://accounts.google.com', clientId: 'old', clientSecret: 'old-secret', setAt: AT });

    await providers.save({ fleetId: FLEET, issuer: 'https://accounts.google.com', clientId: 'gateway', clientSecret: 'google-secret', setAt: AT });

    await expect(Promise.all([providers.find(FLEET), providers.find(OTHER_FLEET)])).resolves.toEqual([
      { fleetId: FLEET, issuer: 'https://accounts.google.com', clientId: 'gateway', clientSecret: 'google-secret', setAt: AT },
      undefined,
    ]);
  });

  it('forgets a fleet with its identity provider (decision 0021)', async () => {
    const providers = createPrismaIdentityProviders(prisma);
    await providers.save({ fleetId: OTHER_FLEET, issuer: 'https://accounts.google.com', clientId: 'gateway', clientSecret: 's', setAt: AT });

    await createPrismaFleetForgetter(prisma).forget(OTHER_FLEET);

    await expect(providers.find(OTHER_FLEET)).resolves.toBeUndefined();
  });
});

describe("argo sets the fleet's identity provider through the gateway's API", () => {
  let fleet: FleetServer;
  let app: GatewayApp;
  let address: string;
  let cookie: string;

  beforeEach(async () => {
    fleet = await startFleetServer(inject('postgresUrl'));
    cookie = await signIn(fleet);
    app = createGatewayApp({ databaseUrl: await migratedDatabase(inject('postgresUrl')), fleetUrl: fleet.url, logger: false, gatewaySecret: TEST_GATEWAY_SECRET });
    address = await app.server.listen({ host: '127.0.0.1', port: 0 });
  });

  afterEach(async () => {
    await app.close();
    await fleet.stop();
  });

  const shown = z.object({ result: z.object({ data: z.unknown() }) });

  it('sets it, and reads it back without its secret', async () => {
    const issuer = provider.issuerOf('company');

    const set = await mutate(address, { procedure: 'identityProvider.set', cookie, body: { issuer, clientId: 'gateway', clientSecret: 'company-secret' } });
    const read = await query(address, { procedure: 'identityProvider.get', cookie });

    expect(set.status).toBe(200);
    const body = await read.text();
    expect(shown.parse(JSON.parse(body)).result.data).toMatchObject({ issuer, clientId: 'gateway' });
    expect(body).not.toContain('company-secret');
  });

  it('refuses one whose OpenID configuration it cannot read', async () => {
    const set = await mutate(address, { procedure: 'identityProvider.set', cookie, body: { issuer: `http://127.0.0.1:${String(await aFreePort())}/company`, clientId: 'gateway', clientSecret: 's' } });

    expect(set.status).toBe(400);
    await expect(query(address, { procedure: 'identityProvider.get', cookie }).then(async (response) => shown.parse(await response.json()).result.data)).resolves.toBeNull();
  });
});

/** PKCE S256 of a verifier, computed here on its own (RFC 7636). */
const challengeOf = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

const locationOf = (response: Response) => z.string().parse(response.headers.get('location'));

describe('the gateway signs a person in at an identity provider (OpenID Connect)', () => {
  const discovery = createProviderDiscovery({ timeoutMs: 5000 });
  const providerSignIn = createProviderSignIn({ timeoutMs: 5000 });
  const REDIRECT_URI = 'http://127.0.0.1:9/oidc/callback';
  const VERIFIER = 'a-verifier-of-at-least-43-characters-for-pkce-0001';

  /** The provider's OpenID configuration, as the gateway reads it. */
  async function metadataOf(issuer: string) {
    const discovered = await discovery.discover(issuer);
    if (!discovered.isOk) {
      throw new Error(discovered.error.reason);
    }
    return discovered.value;
  }

  /** The code the provider sends the person back with, for a sign-in with this nonce. */
  async function aProviderCode(issuer: string, nonce: string): Promise<string> {
    const query = new URLSearchParams({ response_type: 'code', client_id: PROVIDER_CLIENT_ID, redirect_uri: REDIRECT_URI, scope: 'openid email', state: 's', nonce, code_challenge: challengeOf(VERIFIER), code_challenge_method: 'S256' });
    const answer = await fetch(`${(await metadataOf(issuer)).authorizationEndpoint}?${query.toString()}`, { redirect: 'manual' });
    return z.string().parse(new URL(locationOf(answer)).searchParams.get('code'));
  }

  async function completed(input: { nonce: string; clientId?: string }) {
    const issuer = provider.issuerOf('company');
    const code = await aProviderCode(issuer, 'nonce-1');
    return providerSignIn.complete({
      provider: { fleetId: FLEET, issuer, clientId: input.clientId ?? PROVIDER_CLIENT_ID, clientSecret: 'provider-secret', setAt: AT },
      metadata: await metadataOf(issuer),
      code,
      redirectUri: REDIRECT_URI,
      verifier: VERIFIER,
      nonce: input.nonce,
    });
  }

  it('vouches for the person its ID token names: the issuer, the subject and the verified email', async () => {
    await expect(completed({ nonce: 'nonce-1' })).resolves.toEqual({ isOk: true, value: { issuer: provider.issuerOf('company'), subject: CHARLOTTE.subject, email: CHARLOTTE.email } });
  });

  it("refuses an ID token for another sign-in's nonce", async () => {
    await expect(completed({ nonce: 'nonce-2' })).resolves.toMatchObject({ isOk: false });
  });

  it("refuses an ID token for another client than the gateway's", async () => {
    await expect(completed({ nonce: 'nonce-1', clientId: 'another-client' })).resolves.toMatchObject({ isOk: false });
  });
});

describe('the sign-ins under way in Postgres', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createPrismaClient(await migratedDatabase(inject('postgresUrl')));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('keeps a sign-in by its state, and hands it to one take only', async () => {
    const signIns = createPrismaSignIns(prisma);
    const signIn = { stateHash: 'state-hash-1', fleetId: FLEET, request: { client_id: 'client-1', resource: 'https://gateway.example.com/fleets/a/mcp' }, verifier: 'v', nonce: 'n', expiresAt: AT };
    await signIns.save(signIn);

    const takes = await Promise.all([signIns.take('state-hash-1'), signIns.take('state-hash-1')]);

    expect(takes.filter((taken) => taken !== undefined)).toEqual([signIn]);
  });
});

describe('a person signs in from their MCP client, at the fleet\'s identity provider (Q25: no console session)', () => {
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
    app = createGatewayApp({ databaseUrl, fleetUrl: fleet.url, logger: false, publicUrl: address, gatewaySecret: TEST_GATEWAY_SECRET });
    await app.server.listen({ host: '127.0.0.1', port });
  });

  afterEach(async () => {
    await app.close();
    await fleet.stop();
  });

  it('is sent to the provider and back, and the gateway knows them by what the provider vouched for', async () => {
    const setting = { fleet, address, cookie, databaseUrl };
    await aConnectedGateway(setting);
    const set = await mutate(address, { procedure: 'identityProvider.set', cookie, body: { issuer: provider.issuerOf('company'), clientId: PROVIDER_CLIENT_ID, clientSecret: 'provider-secret' } });
    expect(set.status).toBe(200);
    const registered = await mutate(address, { procedure: 'oauth.registerClient', cookie, body: { name: 'Charlotte\'s Claude', redirectUris: [CALLBACK], isConfidential: false } });
    const { clientId } = z.object({ result: z.object({ data: z.object({ clientId: z.string() }) }) }).parse(await registered.json()).result.data;
    const request = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: challengeOf('client-verifier-of-at-least-43-characters-000001'), code_challenge_method: 'S256', resource: await mcpEndpointOf(setting), state: 'client-state' });

    const page = await fetch(`${address}/authorize?${request.toString()}`);
    const signInLink = z.string().parse(/href="(\/authorize\/sign-in\?[^"]+)"/.exec(await page.text())?.[1]).replaceAll('&amp;', '&');
    const toProvider = await fetch(`${address}${signInLink}`, { redirect: 'manual' });
    const back = await fetch(locationOf(toProvider), { redirect: 'manual' });
    const signedIn = await fetch(locationOf(back), { redirect: 'manual' });

    expect({ page: page.status, toProvider: toProvider.status, isAtProvider: locationOf(toProvider).startsWith(provider.issuerOf('company')), isBackAtGateway: locationOf(back).startsWith(`${address}/oidc/callback?`) }).toEqual({ page: 200, toProvider: 302, isAtProvider: true, isBackAtGateway: true });
    expect({ status: signedIn.status, isNamed: (await signedIn.text()).includes(CHARLOTTE.email) }).toEqual({ status: 403, isNamed: true });
  });

  /**
   * Charlotte, mapped by argo to her own ship by her email, signs in from
   * her MCP SDK client at the local OpenID provider: her ship, the client,
   * and how she came back from the sign-in.
   */
  async function aSignedInPerson() {
    const setting = { fleet, address, cookie, databaseUrl };
    await aConnectedGateway(setting);
    await mutate(address, { procedure: 'identityProvider.set', cookie, body: { issuer: provider.issuerOf('company'), clientId: PROVIDER_CLIENT_ID, clientSecret: 'provider-secret' } });
    const ship = await commission(fleet, { cookie, ship: { name: 'charlotte', type: 'person', kind: 'person' } });
    const mapped = await mutate(address, { procedure: 'people.map', cookie, body: { email: CHARLOTTE.email, shipId: ship.shipId, secret: ship.secret } });
    expect(mapped.status).toBe(200);
    const client = aClientProvider(await aRegisteredClient(setting, false));
    const serverUrl = await mcpEndpointOf(setting);
    await auth(client.provider, { serverUrl });
    const page = await fetch(z.instanceof(URL).parse(client.sentTo()));
    const signInLink = z.string().parse(/href="(\/authorize\/sign-in\?[^"]+)"/.exec(await page.text())?.[1]).replaceAll('&amp;', '&');
    const toProvider = await fetch(`${address}${signInLink}`, { redirect: 'manual' });
    const back = await fetch(locationOf(toProvider), { redirect: 'manual' });
    const signedIn = await fetch(locationOf(back), { redirect: 'manual' });
    const sentBack = new URL(locationOf(signedIn));
    await auth(client.provider, { serverUrl, authorizationCode: z.string().parse(sentBack.searchParams.get('code')), iss: z.string().parse(sentBack.searchParams.get('iss')) });
    return { shipId: ship.shipId, client, serverUrl, signedIn, sentBack };
  }

  it('is sent back to their MCP client as their own ship, which argo mapped them to by their email, and the client takes its token', async () => {
    const { client, signedIn, sentBack } = await aSignedInPerson();

    expect({ status: signedIn.status, to: `${sentBack.origin}${sentBack.pathname}`, hasToken: client.tokens()?.access_token !== undefined }).toEqual({ status: 302, to: CALLBACK, hasToken: true });
  });

  it("reads their own ship's inbox from their MCP client, by titles only, through the gateway that crews it", async () => {
    const person = await aSignedInPerson();
    const tracker = await commission(fleet, { cookie, ship: { name: 'tracker', type: 'tracker' } });
    const question = JSON.stringify({ id: crypto.randomUUID(), title: 'Go for release 1.4?', context: 'All checks are green.', options: [{ key: 1, label: 'Go', detail: 'Ship it today' }], pick: { option: 1, why: 'Green' } });
    await send(fleet, { crewToken: await register(fleet, tracker), to: person.shipId, contentType: QUESTION_CONTENT_TYPE, payload: question });
    const mcp = new Client({ name: 'charlotte-claude', version: '1' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(person.serverUrl), { authProvider: person.client.provider }));

    const { tools } = await mcp.listTools();
    const inbox = await mcp.callTool({ name: 'aeolus_inbox', arguments: {} });
    await mcp.close();

    expect(tools.map(({ name }) => name)).toEqual(['aeolus_inbox', 'aeolus_open']);
    const read = z.object({ waiting: z.number(), deliveries: z.array(z.object({ from: z.string(), title: z.string() }).loose()) }).parse(JSON.parse(z.string().parse(z.array(z.object({ text: z.string() })).parse(inbox.content)[0]?.text)));
    expect({ waiting: read.waiting, deliveries: read.deliveries.map(({ from, title }) => ({ from, title })), hasPayload: JSON.stringify(inbox).includes('All checks are green') }).toEqual({
      waiting: 1,
      deliveries: [{ from: 'tracker', title: 'Go for release 1.4?' }],
      hasPayload: false,
    });
  });

  it('opens a delivery from their MCP client: whole, and acknowledged for them, so it waits no more', async () => {
    const person = await aSignedInPerson();
    const tracker = await commission(fleet, { cookie, ship: { name: 'tracker', type: 'tracker' } });
    const question = JSON.stringify({ id: crypto.randomUUID(), title: 'Go for release 1.4?', context: 'All checks are green.', options: [{ key: 1, label: 'Go', detail: 'Ship it today' }], pick: { option: 1, why: 'Green' } });
    await send(fleet, { crewToken: await register(fleet, tracker), to: person.shipId, contentType: QUESTION_CONTENT_TYPE, payload: question });
    const mcp = new Client({ name: 'charlotte-claude', version: '1' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(person.serverUrl), { authProvider: person.client.provider }));
    const textOf = (result: Awaited<ReturnType<Client['callTool']>>) => z.string().parse(z.array(z.object({ text: z.string() })).parse(result.content)[0]?.text);
    const [waiting] = z.object({ deliveries: z.array(z.object({ deliveryId: z.string() })) }).parse(JSON.parse(textOf(await mcp.callTool({ name: 'aeolus_inbox', arguments: {} })))).deliveries;

    const opened = await mcp.callTool({ name: 'aeolus_open', arguments: { deliveryId: z.string().parse(waiting?.deliveryId) } });
    const after = await mcp.callTool({ name: 'aeolus_inbox', arguments: {} });
    await mcp.close();

    expect(z.object({ from: z.string(), title: z.string(), payload: z.string() }).loose().parse(JSON.parse(textOf(opened)))).toMatchObject({ from: 'tracker', title: 'Go for release 1.4?', payload: question });
    expect(JSON.parse(textOf(after))).toEqual({ waiting: 0, deliveries: [] });
  });
});
