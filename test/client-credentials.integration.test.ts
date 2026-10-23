import { idSchema, startingPromptOutputSchema, type ShipId } from '@aeolus-fleet/common';
import type { Client } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createPrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaPartyStore } from '../src/adapters/prisma/party-store.js';
import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { commission, register, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { PAGASAE_CLIENT, startFakePagasae } from './support/fake-pagasae.js';
import { aFreePort, startFleetServer } from './support/fleet-server.js';
import { mutate, query } from './support/gateway-api.js';
import { aMachineClient, type MachineCredentials } from './support/machine-client.js';
import { aConnectedGateway, fleetIdOf, TEST_GATEWAY_SECRET, type Setting } from './support/mcp-client.js';
import { outsidePartiesOn } from './support/outside-parties.js';
import { receiveOne } from './support/ship.js';

// A client party with no human at the authorize step, as a vendor agent such
// as AgentCore is, signs in with client credentials (vendor platforms V4, VS1)
// and calls a fleet ship's capability at /mcp as its proxy ship. The machine
// client is VS2's (test/support/machine-client.ts).

/** How long a call waits for its answer in these tests: long enough for a ship's reply to travel. */
const MCP_WAIT_MS = 3000;

let setting: Setting;
let app: GatewayApp;
let mcp: Client | undefined;

beforeEach(async () => {
  const fleet = await startFleetServer(inject('postgresUrl'));
  const port = await aFreePort();
  const address = `http://127.0.0.1:${String(port)}`;
  setting = { fleet, address, cookie: await signIn(fleet), databaseUrl: await migratedDatabase(inject('postgresUrl')), pagasae: await startFakePagasae() };
  app = createGatewayApp({ databaseUrl: setting.databaseUrl, fleetUrl: fleet.url, logger: false, publicUrl: address, gatewaySecret: TEST_GATEWAY_SECRET, pagasae: { url: setting.pagasae.url, ...PAGASAE_CLIENT }, mcpWaitMaxMs: MCP_WAIT_MS });
  await app.server.listen({ host: '127.0.0.1', port });
  await aConnectedGateway(setting);
  await outsidePartiesOn(setting.databaseUrl, await fleetIdOf(setting));
});

afterEach(async () => {
  await mcp?.close();
  mcp = undefined;
  await app.close();
  await setting.pagasae.stop();
  await setting.fleet.stop();
});

const addedSchema = z.object({ result: z.object({ data: z.object({ party: z.object({ proxyShipId: idSchema('ship'), state: z.string() }), clientId: z.string(), clientSecret: z.string() }) }) });

/** An approver holding gateway:approve adds the client party agentcore, owned by a person ship: its client credentials and proxy ship. */
async function aClientCredentialsParty(): Promise<MachineCredentials & { proxyShipId: ShipId }> {
  const { fleet, cookie } = setting;
  const owner = await commission(fleet, { cookie, ship: { name: 'person-owner', type: 'person', kind: 'person' } });
  const approver = await register(fleet, await commission(fleet, { cookie, ship: { name: 'approver', type: 'agent', scopes: ['fleet:read', 'gateway:approve'] } }));
  const added = await mutate(setting.address, { procedure: 'parties.addClient', crewToken: approver, body: { requestId: crypto.randomUUID(), name: 'agentcore', ownerShipId: owner.shipId, scopes: ['messages:send', 'messages:receive'] } });
  expect(added.status, await added.clone().text()).toBe(200);
  const { party, clientId, clientSecret } = addedSchema.parse(await added.json()).result.data;
  expect(party.state).toBe('crewed');
  return { clientId, clientSecret, proxyShipId: party.proxyShipId };
}

/** A ship of the fleet that states one capability, as its crew: its id and crew token. */
async function aStatingShip(): Promise<{ shipId: ShipId; crewToken: string }> {
  const ship = await commission(setting.fleet, { cookie: setting.cookie, ship: { name: 'crm', type: 'crm', kind: 'app' } });
  const crewToken = await register(setting.fleet, ship);
  const response = await fetch(`${setting.fleet.url}/api/v1/ship/setStatement`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` },
    body: JSON.stringify({
      summary: 'The CRM: contacts and deals.',
      capabilities: [{ name: 'list_deals', description: "Lists a contact's deals.", inputSchema: { type: 'object', properties: { contactId: { type: 'string' } } }, inputModes: ['application/json'] }],
    }),
  });
  expect(response.status).toBe(200);
  return { shipId: ship.shipId, crewToken };
}

/** The CRM ship sends a plain text message as its crew, an app ship stating no model. */
async function sendAsCrm(crewToken: string, message: { to: ShipId; inReplyTo?: string; payload: string }): Promise<void> {
  const response = await fetch(`${setting.fleet.url}/api/v1/ship/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` },
    body: JSON.stringify({ selector: { kind: 'ship', shipId: message.to }, ...(message.inReplyTo === undefined ? {} : { inReplyTo: message.inReplyTo }), contentType: 'text/plain', payload: message.payload, idempotencyKey: crypto.randomUUID() }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
}

/** /token, as the machine client asks it, with client_secret_basic. */
function token(credentials: MachineCredentials, form: Record<string, string> = { grant_type: 'client_credentials', resource: `${setting.address}/mcp` }): Promise<Response> {
  return fetch(`${setting.address}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}` },
    body: new URLSearchParams(form).toString(),
  });
}

async function accessTokenOf(credentials: MachineCredentials): Promise<string> {
  const answer = await token(credentials);
  expect(answer.status, await answer.clone().text()).toBe(200);
  return z.object({ access_token: z.string() }).parse(await answer.json()).access_token;
}

/** A tools/list at /mcp with a bearer token: the status it answers. */
async function mcpStatus(accessToken: string): Promise<number> {
  const response = await fetch(`${setting.address}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  return response.status;
}

/** The name of the tool the stating ship's list_deals is listed under. */
async function listDealsTool(client: Client): Promise<string> {
  const [tool] = (await client.listTools()).tools.filter((each) => each.name.endsWith('__list_deals'));
  return z.string().parse(tool?.name);
}

describe('a client party signs in with client credentials and calls fleet ships at /mcp (VS1, VS2)', () => {
  it("calls a fleet ship's capability as its proxy ship, through the machine client", async () => {
    const crm = await aStatingShip();
    const party = await aClientCredentialsParty();
    mcp = await aMachineClient(`${setting.address}/mcp`, party);

    await mcp.callTool({ name: await listDealsTool(mcp), arguments: { contactId: 'c1' } });

    expect(await receiveOne(setting.fleet, crm.crewToken)).toMatchObject({ senderShipId: party.proxyShipId, contentType: 'application/json', payload: '{"contactId":"c1"}' });
  });

  it('refuses the machine client with a secret that is not its own', async () => {
    const party = await aClientCredentialsParty();

    await expect(aMachineClient(`${setting.address}/mcp`, { ...party, clientSecret: 'not-the-secret' })).rejects.toThrow();
  });

  it('refuses a token asked for another resource with invalid_target (RFC 8707)', async () => {
    const party = await aClientCredentialsParty();

    const answer = await token(party, { grant_type: 'client_credentials', resource: 'https://other.example.com/mcp' });

    expect({ status: answer.status, body: await answer.json() }).toMatchObject({ status: 400, body: { error: 'invalid_target' } });
  });

  it('refuses its tokens at once, and its client at /token, once the party is retired', async () => {
    const party = await aClientCredentialsParty();
    const accessToken = await accessTokenOf(party);
    expect(await mcpStatus(accessToken)).toBe(200);

    const manager = await register(setting.fleet, await commission(setting.fleet, { cookie: setting.cookie, ship: { name: 'manager', type: 'agent', scopes: ['fleet:read', 'fleet:manage'] } }));
    const retired = await mutate(setting.address, { procedure: 'parties.retire', crewToken: manager, body: { name: 'agentcore' } });
    expect(retired.status, await retired.clone().text()).toBe(200);

    expect([await mcpStatus(accessToken), (await token(party)).status]).toEqual([401, 401]);
  });

  it("refuses /token with unauthorized_client, and an earlier token at /mcp with 403, once the fleet's outside parties are off", async () => {
    const party = await aClientCredentialsParty();
    const accessToken = await accessTokenOf(party);

    const off = await mutate(setting.address, { procedure: 'outsideParties.set', cookie: setting.cookie, body: { isOn: false, isOpenNetworkConfirmed: false } });
    expect(off.status, await off.clone().text()).toBe(200);

    const refused = await token(party);
    expect({ status: refused.status, body: await refused.json(), mcp: await mcpStatus(accessToken) }).toMatchObject({ status: 400, body: { error: 'unauthorized_client' }, mcp: 403 });
  });
});

describe('a client party gets a new secret: its crew is released, and the same proxy ship crewed again (V8)', () => {
  /** argo releases the proxy ship's crew in the console, and takes its new starting prompt: the ship's new secret. */
  async function released(proxyShipId: ShipId): Promise<string> {
    const call = (procedure: string) =>
      fetch(`${setting.fleet.url}/trpc/fleet.${procedure}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: setting.fleet.url, cookie: setting.cookie }, body: JSON.stringify({ shipId: proxyShipId }) });
    const release = await call('release');
    expect(release.status, await release.clone().text()).toBe(200);
    const prompt = await call('getStartingPrompt');
    return z.object({ result: z.object({ data: startingPromptOutputSchema }) }).parse(await prompt.json()).result.data.secret;
  }

  /** argo crews the party again with the ship's new secret: the party's new client secret. */
  async function crewedAgain(secret: string): Promise<string> {
    const crewed = await mutate(setting.address, { procedure: 'parties.crew', cookie: setting.cookie, body: { name: 'agentcore', secret } });
    expect(crewed.status, await crewed.clone().text()).toBe(200);
    return z.object({ result: z.object({ data: z.object({ clientSecret: z.string() }) }) }).parse(await crewed.json()).result.data.clientSecret;
  }

  it('answers a new client secret; the old one is refused at /token, the new one signs in', async () => {
    const party = await aClientCredentialsParty();

    const clientSecret = await crewedAgain(await released(party.proxyShipId));

    expect([(await token(party)).status, (await token({ ...party, clientSecret })).status]).toEqual([401, 200]);
  });

  it('keeps the proxy ship, its id and name, so the party is reached as before', async () => {
    const party = await aClientCredentialsParty();

    await crewedAgain(await released(party.proxyShipId));

    const read = await query(setting.address, { procedure: 'parties.get', cookie: setting.cookie, input: { name: 'agentcore' } });
    expect(z.object({ result: z.object({ data: z.object({ proxyShipId: z.string(), proxyShipName: z.string().nullable() }) }) }).parse(await read.json()).result.data).toEqual({ proxyShipId: party.proxyShipId, proxyShipName: 'agentcore' });
  });

  it('delivers a message routed to the party before the release to the same proxy ship after it', async () => {
    const crm = await aStatingShip();
    const party = await aClientCredentialsParty();
    await sendAsCrm(crm.crewToken, { to: party.proxyShipId, payload: 'Deal c1 closed' });

    await crewedAgain(await released(party.proxyShipId));

    const prisma = createPrismaClient(setting.databaseUrl);
    const kept = await createPrismaPartyStore(prisma).find(await fleetIdOf(setting), 'agentcore');
    await prisma.$disconnect();
    expect(await receiveOne(setting.fleet, z.string().parse(kept?.crewToken))).toMatchObject({ senderShipId: crm.shipId, payload: 'Deal c1 closed' });
  });

  it("takes the replies to the calls the machine client makes with its new secret", async () => {
    const crm = await aStatingShip();
    const party = await aClientCredentialsParty();
    const clientSecret = await crewedAgain(await released(party.proxyShipId));
    mcp = await aMachineClient(`${setting.address}/mcp`, { ...party, clientSecret });

    const called = await mcp.callTool({ name: await listDealsTool(mcp), arguments: { contactId: 'c1' } });
    const { handle } = z.object({ handle: z.string() }).parse(JSON.parse(z.array(z.object({ text: z.string() })).parse(called.content)[0]?.text ?? ''));
    const call = await receiveOne(setting.fleet, crm.crewToken);
    await sendAsCrm(crm.crewToken, { to: party.proxyShipId, inReplyTo: z.string().parse(call?.messageId), payload: 'No deals' });

    const client = mcp;
    await expect.poll(async () => z.array(z.object({ text: z.string() })).parse((await client.callTool({ name: 'aeolus_result', arguments: { handle } })).content)[0]?.text).toBe('No deals');
  });
});
