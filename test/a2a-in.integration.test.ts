import type { ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createGatewayApp, type GatewayApp } from '../src/app.js';
import { commission, register, signIn } from './support/argo.js';
import { migratedDatabase } from './support/database.js';
import { startFakePagasae } from './support/fake-pagasae.js';
import { aFreePort, startFleetServer } from './support/fleet-server.js';
import { mutate, query } from './support/gateway-api.js';
import { aConnectedGateway, fleetIdOf, TEST_GATEWAY_SECRET, type Setting } from './support/mcp-client.js';
import { outsidePartiesOn } from './support/outside-parties.js';

// A2A in (decision 0060): an approver adds an outside A2A client, and the
// client reads the cards of the ships its proxy ship reaches, by alias. The
// fleet and the gateway are real.

let setting: Setting;
let app: GatewayApp;
/** The crew token of a ship holding gateway:approve and fleet:read. */
let approver: string;
let owner: ShipId;

beforeEach(async () => {
  const fleet = await startFleetServer(inject('postgresUrl'));
  const port = await aFreePort();
  const address = `http://127.0.0.1:${String(port)}`;
  setting = { fleet, address, cookie: await signIn(fleet), databaseUrl: await migratedDatabase(inject('postgresUrl')), pagasae: await startFakePagasae() };
  app = createGatewayApp({ databaseUrl: setting.databaseUrl, fleetUrl: fleet.url, logger: false, publicUrl: address, gatewaySecret: TEST_GATEWAY_SECRET });
  await app.server.listen({ host: '127.0.0.1', port });
  await aConnectedGateway(setting);
  owner = (await commission(fleet, { cookie: setting.cookie, ship: { name: 'person-owner', type: 'person', kind: 'person' } })).shipId;
  approver = await register(fleet, await commission(fleet, { cookie: setting.cookie, ship: { name: 'approver', type: 'agent', scopes: ['fleet:read', 'gateway:approve'] } }));
  await outsidePartiesOn(setting.databaseUrl, await fleetIdOf(setting));
});

afterEach(async () => {
  await app.close();
  await setting.pagasae.stop();
  await setting.fleet.stop();
});

const addedSchema = z.object({ result: z.object({ data: z.object({ party: z.object({ proxyShipId: z.string() }), bearer: z.string() }) }) });

/** The approver adds the supplier's A2A client: the answer as the API gave it. */
function addSupplier(requestId = crypto.randomUUID()): Promise<Response> {
  return mutate(setting.address, { procedure: 'parties.addA2aClient', crewToken: approver, body: { requestId, name: 'supplier', ownerShipId: owner, scopes: ['fleet:read'] } });
}

/** A ship of the fleet that states one capability, as its crew. */
async function aStatingShip(): Promise<void> {
  const crewToken = await register(setting.fleet, await commission(setting.fleet, { cookie: setting.cookie, ship: { name: 'procurement', type: 'procurement', kind: 'app' } }));
  const stated = await fetch(`${setting.fleet.url}/api/v1/ship/setStatement`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${crewToken}` },
    body: JSON.stringify({ summary: 'Procurement: purchase orders.', capabilities: [{ name: 'quote', description: 'Takes a quote for an order.', inputModes: ['text/plain'] }] }),
  });
  expect(stated.status).toBe(200);
}

/** The card addresses the supplier's detail lists. */
async function cardAddresses(): Promise<string[]> {
  const read = await query(setting.address, { procedure: 'parties.cardAddresses', cookie: setting.cookie, input: { name: 'supplier' } });
  return z.object({ result: z.object({ data: z.object({ addresses: z.array(z.string()) }) }) }).parse(await read.json()).result.data.addresses;
}

/** GetExtendedAgentCard at an alias's interface, with the bearer. */
function extendedCard(interfaceUrl: string, bearer: string): Promise<Response> {
  return fetch(interfaceUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}`, 'a2a-version': '1.0' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'GetExtendedAgentCard', params: {} }),
  });
}

describe('an approver adds an outside A2A client', () => {
  it('commissions an a2a-client proxy ship with the owner and scopes chosen, and shows a bearer once', async () => {
    const added = await addSupplier();
    expect(added.status, await added.clone().text()).toBe(200);
    const { party, bearer } = addedSchema.parse(await added.json()).result.data;

    const ship = await fetch(`${setting.fleet.url}/api/v1/fleet/ship`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${approver}` }, body: JSON.stringify({ shipId: party.proxyShipId }) });
    const read = await query(setting.address, { procedure: 'parties.get', cookie: setting.cookie, input: { name: 'supplier' } });

    const detail = await read.text();

    expect(await ship.json()).toMatchObject({ name: 'supplier', type: 'a2a-client', kind: 'app' });
    const shown = z.object({ result: z.object({ data: z.object({ kind: z.string(), state: z.string(), ownerShipId: z.string().nullable(), scopes: z.array(z.string()).nullable() }) }) }).parse(JSON.parse(detail)).result.data;
    expect({ ...shown, hasRead: shown.scopes?.includes('fleet:read') }).toMatchObject({ kind: 'a2aClient', state: 'crewed', ownerShipId: owner, hasRead: true });
    expect(bearer).toMatch(/^\S{32,}$/);
    expect(detail).not.toContain(bearer);
  });

  it("adds nothing while the fleet's outside parties are off, and refuses every A2A call", async () => {
    const added = addedSchema.parse(await (await addSupplier()).json()).result.data;
    await aStatingShip();
    const [address = ''] = await cardAddresses();
    const off = await mutate(setting.address, { procedure: 'outsideParties.set', cookie: setting.cookie, body: { isOn: false, isOpenNetworkConfirmed: false } });
    expect(off.status, await off.clone().text()).toBe(200);

    const again = await mutate(setting.address, { procedure: 'parties.addA2aClient', crewToken: approver, body: { requestId: crypto.randomUUID(), name: 'another', ownerShipId: owner, scopes: [] } });
    const called = await extendedCard(address.replace('/.well-known/agent-card.json', ''), added.bearer);

    expect({ added: again.status, called: called.status }).toEqual({ added: 412, called: 403 });
  });
});

describe('an outside A2A client reads the cards of the ships its proxy ship reaches', () => {
  it("lists a card address per reachable ship on the party's detail, and serves its public card with no skills", async () => {
    await addSupplier();
    await aStatingShip();

    const addresses = await cardAddresses();
    const cards = await Promise.all(addresses.map(async (address) => z.record(z.string(), z.unknown()).parse(await (await fetch(address)).json())));

    expect(addresses.every((address) => new RegExp(`^${setting.address}/gw/a2a/[a-z][a-z2-7]{7}/\\.well-known/agent-card\\.json$`).test(address))).toBe(true);
    expect(addresses.length).toBeGreaterThan(0);
    expect(cards.map((card) => ({ hasSkills: 'skills' in card, capabilities: card.capabilities }))).toEqual(cards.map(() => ({ hasSkills: false, capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: true } })));
    expect(JSON.stringify(cards)).not.toContain('procurement');
  });

  it("answers the reachable ship's statement as its extended card", async () => {
    const { bearer } = addedSchema.parse(await (await addSupplier()).json()).result.data;
    await aStatingShip();
    const publicCards = await Promise.all((await cardAddresses()).map(async (address) => z.object({ supportedInterfaces: z.array(z.object({ url: z.string() })) }).parse(await (await fetch(address)).json())));

    const extended = await Promise.all(publicCards.map(async (card) => z.object({ result: z.object({ description: z.string(), skills: z.array(z.object({ id: z.string() })).optional() }) }).parse(await (await extendedCard(card.supportedInterfaces[0]?.url ?? '', bearer)).json())));

    expect(extended.map(({ result }) => result)).toContainEqual(expect.objectContaining({ description: 'Procurement: purchase orders.', skills: [expect.objectContaining({ id: 'quote' })] }));
  });

  it('answers the unknown-alias error for an alias of no ship', async () => {
    const { bearer } = addedSchema.parse(await (await addSupplier()).json()).result.data;

    const called = await extendedCard(`${setting.address}/gw/a2a/azzzzzzz`, bearer);

    expect(called.status).toBe(404);
  });
});
