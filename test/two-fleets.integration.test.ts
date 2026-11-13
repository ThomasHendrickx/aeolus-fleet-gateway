import { createServer, type Server } from 'node:http';

import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { Client, StreamableHTTPClientTransport, auth } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createRestFleetDoor } from '../src/adapters/fleet/rest-fleet-door.js';
import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaPersonCrews } from '../src/adapters/prisma/person-crews.js';
import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { commission, register } from './support/argo.js';
import { aBrowser, pickedAt } from './support/browser.js';
import { migratedDatabase } from './support/database.js';
import { PAGASAE_APP_CLIENT, PAGASAE_CLIENT, startFakePagasae, WAKE_INSTALLATION_TOKEN, type FakePagasae } from './support/fake-pagasae.js';
import { aFleetOfTheInstallation, aFreePort, startInstallationServer, type FleetServer } from './support/fleet-server.js';
import { connectGateway, mutate } from './support/gateway-api.js';
import { aClientProvider, aRegisteredClient, CALLBACK, TEST_GATEWAY_SECRET } from './support/mcp-client.js';

// One account in two fleets of one organisation, Acme and Labs, as pagasae
// makes them (aeolus-fleet#1764, second fleet design, slice 4): one core
// installation holds both fleets and one gateway serves both. Charlotte has
// a person ship in each, and one shared sign-in. The fleet and the gateway
// are real, and core checks every account token pagasae signs; pagasae is a
// fake, and answers the fleet Charlotte chooses at its choose page.

const GATEWAY_SCOPES = ['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare', 'fleet:verify'];
/** The hosting service's token, for core's installation and the gateway's alike (decision 0021). */
const INSTALLATION_TOKEN = WAKE_INSTALLATION_TOKEN;
const SIGN_IN = 'charlotte-shared-sign-in';
const SEEN_WITHIN_MS = 20_000;

/** One fleet of the organisation as the test holds it: argo's console session, Charlotte's person ship and a tracker ship's crew. */
interface HeldFleet {
  fleetId: FleetId;
  name: string;
  argo: string;
  charlotte: ShipId;
  tracker: string;
}

let pagasae: FakePagasae;
let fleet: FleetServer;
let app: GatewayApp;
let prisma: PrismaClient;
let address: string;
let databaseUrl: string;
let acme: HeldFleet;
let labs: HeldFleet;
let metadataServer: Server;
/** The client id of an MCP client known by its metadata document (CIMD), as Claude is: it belongs to no fleet. */
let metadataClientId: string;

/** A fleet the installation creates for the organisation, with the gateway's ship, Charlotte's person ship and a tracker. */
async function aFleetOfAcme(name: string): Promise<HeldFleet & { gatewayShip: { shipId: ShipId; secret: string } }> {
  const { fleetId, cookie } = await aFleetOfTheInstallation(fleet, { installationToken: INSTALLATION_TOKEN, name });
  const gatewayShip = await commission(fleet, { cookie, ship: { name: 'gateway', type: 'gateway', kind: 'app', scopes: GATEWAY_SCOPES } });
  const charlotte = await commission(fleet, { cookie, ship: { name: 'charlotte', type: 'person', kind: 'person' } });
  const tracker = await register(fleet, await commission(fleet, { cookie, ship: { name: `tracker-${name.toLowerCase()}`, type: 'issue-tracker', kind: 'app' } }));
  return { fleetId, name, argo: cookie, charlotte: charlotte.shipId, tracker, gatewayShip };
}

/** Charlotte's account token claims in a fleet, as pagasae signs them: her person ship there. */
function charlotteClaimsIn(held: HeldFleet): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return { iss: pagasae.url, aud: held.fleetId, sub: 'acc-charlotte', org: 'org-acme', scope: 'fleet:read', group: [], person_ship: held.charlotte, iat: now, exp: now + 600 };
}

async function startMetadataServer(): Promise<{ server: Server; clientId: string }> {
  const port = await aFreePort();
  const clientId = `http://127.0.0.1:${String(port)}/client.json`;
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ client_id: clientId, client_name: 'Claude', redirect_uris: [CALLBACK] }));
  });
  await new Promise<void>((listening) => server.listen(port, '127.0.0.1', listening));
  return { server, clientId };
}

beforeEach(async () => {
  pagasae = await startFakePagasae();
  fleet = await startInstallationServer(inject('postgresUrl'), { installationToken: INSTALLATION_TOKEN, accountTokenIssuer: pagasae.url });
  const [madeAcme, madeLabs] = [await aFleetOfAcme('Acme'), await aFleetOfAcme('Labs')];
  acme = madeAcme;
  labs = madeLabs;
  databaseUrl = await migratedDatabase(inject('postgresUrl'));
  prisma = createPrismaClient(databaseUrl);
  const port = await aFreePort();
  address = `http://127.0.0.1:${String(port)}`;
  app = createGatewayApp({
    databaseUrl,
    fleetUrl: fleet.url,
    logger: false,
    publicUrl: address,
    gatewaySecret: TEST_GATEWAY_SECRET,
    installationToken: INSTALLATION_TOKEN,
    pagasae: { url: pagasae.url, ...PAGASAE_CLIENT },
    pagasaeApp: PAGASAE_APP_CLIENT,
  });
  await app.server.listen({ host: '127.0.0.1', port });
  for (const made of [madeAcme, madeLabs]) {
    expect((await mutate(address, { procedure: 'installation.setEnabled', installationToken: INSTALLATION_TOKEN, body: { requestId: `switch-on-${made.name}`, fleetId: made.fleetId, enabled: true } })).status).toBe(200);
    const connected = await connectGateway(address, { cookie: made.argo, ...made.gatewayShip });
    expect(connected.status, await connected.clone().text()).toBe(200);
  }
  await app.restoreConnections();
  pagasae.sharedSignIn(SIGN_IN, charlotteClaimsIn(acme));
  pagasae.sharedSignIn(SIGN_IN, charlotteClaimsIn(labs));
  pagasae.listFor(SIGN_IN, [
    { id: acme.fleetId, name: 'Acme' },
    { id: labs.fleetId, name: 'Labs' },
  ]);
  ({ server: metadataServer, clientId: metadataClientId } = await startMetadataServer());
});

afterEach(async () => {
  await app.close();
  await prisma.$disconnect();
  await new Promise((closed) => metadataServer.close(closed));
  await pagasae.stop();
  await fleet.stop();
});

/** The gateway switched off for a fleet by the hosting service (decision 0021); pagasae then lists no gateway there. */
async function switchOff(held: HeldFleet): Promise<void> {
  expect((await mutate(address, { procedure: 'installation.setEnabled', installationToken: INSTALLATION_TOKEN, body: { requestId: `switch-off-${held.name}`, fleetId: held.fleetId, enabled: false } })).status).toBe(200);
  pagasae.listFor(SIGN_IN, [
    { id: acme.fleetId, name: 'Acme', hasGateway: held !== acme },
    { id: labs.fleetId, name: 'Labs', hasGateway: held !== labs },
  ]);
}

/** The gateway switched on again for a fleet by the hosting service; pagasae lists it there again. */
async function switchOn(held: HeldFleet): Promise<void> {
  expect((await mutate(address, { procedure: 'installation.setEnabled', installationToken: INSTALLATION_TOKEN, body: { requestId: `switch-on-again-${held.name}`, fleetId: held.fleetId, enabled: true } })).status).toBe(200);
  pagasae.listFor(SIGN_IN, [
    { id: acme.fleetId, name: 'Acme' },
    { id: labs.fleetId, name: 'Labs' },
  ]);
}

/** Charlotte turns email on for everything else in each fleet (Bridge, section 8). */
async function emailOnInBoth(): Promise<void> {
  for (const held of [acme, labs]) {
    expect((await asCharlotte({ procedure: 'people.turnRoute', fleet: held, body: { job: 'everything-else', place: 'email', isOn: true } })).status).toBe(200);
  }
}

/** A page's call to the gateway's API with Charlotte's shared sign-in, in the fleet the page's address names. */
async function asCharlotte(call: { procedure: string; fleet?: HeldFleet; body?: unknown }): Promise<{ status: number; body: unknown }> {
  const headers = { 'content-type': 'application/json', cookie: `aeolus_account_session=${SIGN_IN}`, ...(call.fleet === undefined ? {} : { 'aeolus-fleet': call.fleet.fleetId }) };
  const response = await fetch(`${address}/trpc/${call.procedure}`, call.body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(call.body) });
  return { status: response.status, body: await response.json() };
}

const sendToSchema = z.object({ result: z.object({ data: z.object({ ships: z.array(z.string()) }) }) });

/** The ships Charlotte may send to, as her page in the fleet reads them. */
async function shipNamesIn(held: HeldFleet): Promise<string[]> {
  const read = await asCharlotte({ procedure: 'people.sendTo', fleet: held });
  return sendToSchema.parse(read.body).result.data.ships;
}

/** The fleet and ship the gateway's crew of Charlotte's person ship in a fleet is the crew of, as the fleet answers it. */
async function crewedAs(held: HeldFleet): Promise<{ fleetId: FleetId; shipId: ShipId } | undefined> {
  const crew = await createPrismaPersonCrews(prisma).find(held.fleetId, held.charlotte);
  if (crew === undefined) {
    return undefined;
  }
  const who = await createRestFleetDoor(fleet.url).whoami(crew.crewToken);
  return who.isOk ? { fleetId: who.value.fleetId, shipId: who.value.shipId } : undefined;
}

/** The tracker of a fleet sends Charlotte a message there: its id. */
async function trackerSendsCharlotte(held: HeldFleet): Promise<string> {
  const sent = await fetch(`${fleet.url}/api/v1/ship/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${held.tracker}` },
    body: JSON.stringify({ selector: { kind: 'ship', name: 'charlotte' }, contentType: 'text/plain', payload: `An issue in ${held.name} is closed`, idempotencyKey: crypto.randomUUID() }),
  });
  expect(sent.status).toBe(200);
  return z.object({ messageId: z.string() }).parse(await sent.json()).messageId;
}

const historySchema = z.object({ result: z.object({ data: z.object({ delivery: z.object({ history: z.array(z.object({ type: z.string(), channel: z.string().nullable().optional() })) }) }) }) });

/** Each hand-over of a message's delivery, by its channel, as argo of its fleet reads its way in the console. */
async function handOversOf(held: HeldFleet, messageId: string): Promise<(string | null | undefined)[]> {
  const read = await fetch(`${fleet.url}/trpc/fleet.message?input=${encodeURIComponent(JSON.stringify({ messageId }))}`, { headers: { cookie: held.argo, origin: fleet.url } });
  return historySchema.parse(await read.json()).result.data.delivery.history.filter(({ type }) => type === 'DeliveryHanded').map(({ channel }) => channel);
}

/**
 * Charlotte signs in from an MCP client known by its metadata document, and
 * chooses the fleet at pagasae: where the browser lands, the code or the
 * failure page, and the client.
 */
async function signsInFromClaude(chosen: HeldFleet, stopAt = CALLBACK): Promise<{ landedAt: URL; client: ReturnType<typeof aClientProvider> }> {
  const client = aClientProvider({ clientId: metadataClientId, clientSecret: null });
  await auth(client.provider, { serverUrl: `${address}/mcp` });
  pagasae.answer(charlotteClaimsIn(chosen));
  const landed = await aBrowser().follow(pickedAt(z.instanceof(URL).parse(client.sentTo()), 'account'), stopAt);
  return { landedAt: new URL(z.string().parse(landed.headers.get('location')), address), client };
}

/** The client takes its tokens for the code it was sent back with. */
async function takesTokens(signedIn: { landedAt: URL; client: ReturnType<typeof aClientProvider> }): Promise<void> {
  const iss = signedIn.landedAt.searchParams.get('iss');
  await expect(auth(signedIn.client.provider, { serverUrl: `${address}/mcp`, authorizationCode: z.string().parse(signedIn.landedAt.searchParams.get('code')), ...(iss === null ? {} : { iss }) })).resolves.toBe('AUTHORIZED');
}

/** What /mcp answers the client's call of a tool with its access token: the HTTP status, and whether the tool answered (an error or not). */
async function callsTool(client: ReturnType<typeof aClientProvider>, name: string): Promise<{ status: number; isError: boolean | undefined }> {
  const tokens = await client.provider.tokens();
  const response = await fetch(`${address}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${z.string().parse(tokens?.access_token)}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: {} } }),
  });
  const text = await response.text();
  const isError = text.includes('"isError":true') ? true : text.includes('"result"') ? false : undefined;
  return { status: response.status, isError };
}

/** The ships the client's MCP session lists, by aeolus_ships, once it took its tokens for the code. */
async function shipsTheClientLists(signedIn: { landedAt: URL; client: ReturnType<typeof aClientProvider> }): Promise<string> {
  const serverUrl = `${address}/mcp`;
  await takesTokens(signedIn);
  const mcp = new Client({ name: 'claude', version: '1' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider: signedIn.client.provider }));
  try {
    const listed = z.object({ content: z.array(z.object({ text: z.string() })) }).parse(await mcp.callTool({ name: 'aeolus_ships', arguments: {} }));
    return listed.content.map(({ text }) => text).join('\n');
  } finally {
    await mcp.close();
  }
}

describe("one account in two fleets of one organisation: its person ship in each (second fleet, slice 4)", () => {
  it('is crewed in each fleet, as the ship of that fleet, by the one sign-in', async () => {
    expect((await asCharlotte({ procedure: 'people.inbox', fleet: acme })).status).toBe(200);
    expect((await asCharlotte({ procedure: 'people.inbox', fleet: labs })).status).toBe(200);

    expect({ acme: await crewedAs(acme), labs: await crewedAs(labs) }).toEqual({
      acme: { fleetId: acme.fleetId, shipId: acme.charlotte },
      labs: { fleetId: labs.fleetId, shipId: labs.charlotte },
    });
  });

  it('is woken in the fleet a message waits in: each wake names that fleet and its person ship there', async () => {
    for (const held of [acme, labs]) {
      expect((await asCharlotte({ procedure: 'people.turnRoute', fleet: held, body: { job: 'everything-else', place: 'email', isOn: true } })).status).toBe(200);
    }

    await trackerSendsCharlotte(labs);
    await expect.poll(() => pagasae.wakes.length, { timeout: SEEN_WITHIN_MS }).toBe(1);
    await trackerSendsCharlotte(acme);
    await expect.poll(() => pagasae.wakes.length, { timeout: SEEN_WITHIN_MS }).toBe(2);

    expect(pagasae.wakes).toEqual([
      { fleetId: labs.fleetId, shipId: labs.charlotte },
      { fleetId: acme.fleetId, shipId: acme.charlotte },
    ]);
  });
});

describe("one account in two fleets of one organisation: switching fleets on the gateway's pages", () => {
  it('shows the other fleet with the same sign-in: the account there, and the ships it may send to there', async () => {
    const inAcme = { view: (await asCharlotte({ procedure: 'account.inView', fleet: acme })).body, ships: await shipNamesIn(acme) };
    const inLabs = { view: (await asCharlotte({ procedure: 'account.inView', fleet: labs })).body, ships: await shipNamesIn(labs) };

    expect({
      acme: { view: inAcme.view, own: inAcme.ships.includes('tracker-acme'), other: inAcme.ships.includes('tracker-labs') },
      labs: { view: inLabs.view, own: inLabs.ships.includes('tracker-labs'), other: inLabs.ships.includes('tracker-acme') },
    }).toEqual({
      acme: { view: { result: { data: { kind: 'signedIn', fleetId: acme.fleetId, accountId: 'acc-charlotte', scopes: ['fleet:read'] } } }, own: true, other: false },
      labs: { view: { result: { data: { kind: 'signedIn', fleetId: labs.fleetId, accountId: 'acc-charlotte', scopes: ['fleet:read'] } } }, own: true, other: false },
    });
  });

  it('goes back to the first fleet again, the token for one fleet never used for the other', async () => {
    await shipNamesIn(labs);

    await expect(shipNamesIn(acme)).resolves.not.toContain('tracker-labs');
  });
});

describe('one account in two fleets of one organisation: the gateway on in Acme and off in Labs', () => {
  it("is reached on the pages only in Acme: Labs's own reads are refused, Acme's answered", async () => {
    await switchOff(labs);

    const [inAcme, inLabs] = [await asCharlotte({ procedure: 'people.inbox', fleet: acme }), await asCharlotte({ procedure: 'people.inbox', fleet: labs })];

    expect({ acme: inAcme.status, labs: inLabs.status }).toEqual({ acme: 200, labs: 403 });
  });

  it('sends a page that names no fleet to Acme, where the account may open the gateway, though Labs is listed first', async () => {
    await switchOff(labs);
    pagasae.listFor(SIGN_IN, [
      { id: labs.fleetId, name: 'Labs', hasGateway: false },
      { id: acme.fleetId, name: 'Acme' },
    ]);

    await expect(asCharlotte({ procedure: 'account.inView' })).resolves.toEqual({ status: 200, body: { result: { data: { kind: 'goTo', fleetId: acme.fleetId } } } });
  });

  it('does not crew the person ship in Labs', async () => {
    await switchOff(labs);

    await asCharlotte({ procedure: 'people.inbox', fleet: labs });

    await expect(crewedAs(labs)).resolves.toBeUndefined();
  });

  it('shows a page that names Labs the notice that the gateway is off there, and who turns it on', async () => {
    await switchOff(labs);

    await expect(asCharlotte({ procedure: 'account.inView', fleet: labs })).resolves.toEqual({ status: 200, body: { result: { data: { kind: 'off', fleetName: 'Labs', accountUrl: 'http://pagasae.test/account' } } } });
  });

  it("serves an account's MCP tools only where the gateway is on: Acme's session answered, Labs's refused, and answered again once Labs is on", async () => {
    const inLabs = await signsInFromClaude(labs);
    await takesTokens(inLabs);
    const inAcme = await signsInFromClaude(acme);
    await takesTokens(inAcme);

    await switchOff(labs);
    const whileOff = { acme: await callsTool(inAcme.client, 'aeolus_ships'), labs: await callsTool(inLabs.client, 'aeolus_ships') };
    await switchOn(labs);

    expect({ whileOff, labsOnAgain: await callsTool(inLabs.client, 'aeolus_ships') }).toEqual({
      whileOff: { acme: { status: 200, isError: false }, labs: { status: 403, isError: undefined } },
      labsOnAgain: { status: 200, isError: false },
    });
  });

  it("lists the account's requests only where the gateway is on: Acme's answered, Labs's refused, and answered again once Labs is on", async () => {
    await switchOff(labs);
    const whileOff = { acme: await asCharlotte({ procedure: 'requests.mine', fleet: acme }), labs: await asCharlotte({ procedure: 'requests.mine', fleet: labs }) };
    await switchOn(labs);

    expect({ whileOff, labsOnAgain: await asCharlotte({ procedure: 'requests.mine', fleet: labs }) }).toMatchObject({
      whileOff: { acme: { status: 200, body: { result: { data: [] } } }, labs: { status: 403, body: { error: { message: 'The gateway is off for this fleet' } } } },
      labsOnAgain: { status: 200, body: { result: { data: [] } } },
    });
  });

  it('wakes the person only where the gateway is on: a message in Acme wakes, one in Labs waits', async () => {
    await emailOnInBoth();
    await switchOff(labs);

    await trackerSendsCharlotte(labs);
    await trackerSendsCharlotte(acme);
    await expect.poll(() => pagasae.wakes.some(({ fleetId }) => fleetId === acme.fleetId), { timeout: SEEN_WITHIN_MS }).toBe(true);

    expect(pagasae.wakes).toEqual([{ fleetId: acme.fleetId, shipId: acme.charlotte }]);
  });

  it('wakes the person once for what waited in Labs when the gateway is on there again, and not again after', async () => {
    await emailOnInBoth();
    await switchOff(labs);
    const waited = await trackerSendsCharlotte(labs);
    // Acme's wake shows the waiters ran while Labs's message waited.
    await trackerSendsCharlotte(acme);
    await expect.poll(() => pagasae.wakes.length, { timeout: SEEN_WITHIN_MS }).toBe(1);
    const handedWhileOff = await handOversOf(labs, waited);

    await switchOn(labs);
    await expect.poll(() => pagasae.wakes.length, { timeout: SEEN_WITHIN_MS }).toBe(2);
    // A round of the waiters and more, for a second wake to show if there were one.
    await new Promise((resolve) => setTimeout(resolve, 12_000));

    expect({ wakes: pagasae.wakes, handedWhileOff, handed: await handOversOf(labs, waited) }).toEqual({
      wakes: [
        { fleetId: acme.fleetId, shipId: acme.charlotte },
        { fleetId: labs.fleetId, shipId: labs.charlotte },
      ],
      handedWhileOff: [],
      handed: ['email'],
    });
  });

  it('signs an MCP client in only to Acme: choosing Labs at pagasae lands on the failure page', async () => {
    await switchOff(labs);

    const [inLabs, inAcme] = [await signsInFromClaude(labs, `${address}/authorize/failed`), await signsInFromClaude(acme)];

    expect({ labs: `${inLabs.landedAt.pathname}${inLabs.landedAt.search}`, acme: inAcme.landedAt.origin + inAcme.landedAt.pathname }).toEqual({ labs: '/authorize/failed?reason=fleetNotServed', acme: CALLBACK });
  });
});

describe("one account in two fleets of one organisation: an MCP client's sign-in at the gateway's address", () => {
  it('sends the person to pagasae naming no fleet, so pagasae asks which', async () => {
    await signsInFromClaude(labs);

    const sentTo = pagasae.authorizeRequests.at(-1);
    expect([...(sentTo?.searchParams.values() ?? [])].filter((value) => value.includes(acme.fleetId) || value.includes(labs.fleetId))).toEqual([]);
  });

  it('acts in the fleet the account chose: Labs, then from another client Acme', async () => {
    const chosenLabs = await shipsTheClientLists(await signsInFromClaude(labs));
    const chosenAcme = await shipsTheClientLists(await signsInFromClaude(acme));

    expect({ labs: { own: chosenLabs.includes('tracker-labs'), other: chosenLabs.includes('tracker-acme') }, acme: { own: chosenAcme.includes('tracker-acme'), other: chosenAcme.includes('tracker-labs') } }).toEqual({
      labs: { own: true, other: false },
      acme: { own: true, other: false },
    });
  });

  it('is refused for a sign-in with no browser to choose in: the ID-JAG of an account in two fleets, as today (company sign-in design, D9)', async () => {
    const client = await aRegisteredClient({ fleet, address, cookie: acme.argo, databaseUrl, pagasae }, true);

    const answered = await fetch(`${address}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: 'an-id-jag-for-charlotte', client_id: client.clientId, client_secret: z.string().parse(client.clientSecret) }),
    });

    expect({ status: answered.status, body: await answered.json() }).toEqual({
      status: 400,
      body: { error: 'invalid_grant', error_description: 'The ID-JAG was refused. ID-JAG is only available for accounts in one fleet: an account in several signs in at the gateway’s address to choose one' },
    });
  });
});
