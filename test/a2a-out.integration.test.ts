import { createServer, type Server } from 'node:http';

import { discoverOutputSchema, type ShipId } from '@aeolus-fleet/common';
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

// A2A out, slice 5: an approver adds an outside A2A agent by its card
// address, and fleet ships discover its skills as its proxy ship's
// capabilities. The fleet and the gateway are real; the agent is a local
// server answering its card.

/** The card the agent serves, with an interface the gateway calls. */
const CARD = {
  name: 'Supplier agent',
  description: 'Quotes and books parts.',
  version: '1.0.0',
  supportedInterfaces: [{ url: 'https://agent.supplier.example/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
  capabilities: { streaming: true },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['application/json'],
  skills: [
    { id: 'quote', name: 'Quote a price', description: 'Answers a price for a part list.', tags: ['quotes'] },
    { id: 'book', name: 'Book parts', description: 'Books the parts of a quote.', tags: ['orders'], inputModes: ['application/json'] },
  ],
};

let setting: Setting;
let app: GatewayApp;
let agent: Server;
let served: unknown;
let cardUrl: string;
/** The crew token of a ship holding gateway:approve and fleet:read. */
let approver: string;
/** The crew token of a fleet ship that discovers. */
let caller: string;
let owner: ShipId;

beforeEach(async () => {
  served = CARD;
  agent = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(served));
  });
  await new Promise<void>((resolve) => agent.listen(0, '127.0.0.1', resolve));
  cardUrl = `http://127.0.0.1:${String(z.object({ port: z.number() }).parse(agent.address()).port)}/.well-known/agent-card.json`;
  const fleet = await startFleetServer(inject('postgresUrl'));
  const port = await aFreePort();
  setting = { fleet, address: `http://127.0.0.1:${String(port)}`, cookie: await signIn(fleet), databaseUrl: await migratedDatabase(inject('postgresUrl')), pagasae: await startFakePagasae() };
  app = createGatewayApp({ databaseUrl: setting.databaseUrl, fleetUrl: fleet.url, logger: false, publicUrl: setting.address, gatewaySecret: TEST_GATEWAY_SECRET });
  await app.server.listen({ host: '127.0.0.1', port });
  await aConnectedGateway(setting);
  owner = (await commission(fleet, { cookie: setting.cookie, ship: { name: 'person-owner', type: 'person', kind: 'person' } })).shipId;
  approver = await register(fleet, await commission(fleet, { cookie: setting.cookie, ship: { name: 'approver', type: 'agent', scopes: ['fleet:read', 'gateway:approve'] } }));
  caller = await register(fleet, await commission(fleet, { cookie: setting.cookie, ship: { name: 'buyer', type: 'agent', scopes: ['messages:send'] } }));
  await outsidePartiesOn(setting.databaseUrl, await fleetIdOf(setting));
});

afterEach(async () => {
  await app.close();
  agent.closeAllConnections();
  await new Promise((resolve) => agent.close(resolve));
  await setting.pagasae.stop();
  await setting.fleet.stop();
});

const addedSchema = z.object({ result: z.object({ data: z.object({ proxyShipId: z.string(), kind: z.string(), cardUrl: z.string(), credentialKind: z.string(), isRepeatable: z.boolean() }) }) });

/** The approver adds the supplier's agent: the answer as the API gave it. */
function addAgent(change: Record<string, unknown> = {}): Promise<Response> {
  return mutate(setting.address, { procedure: 'parties.addA2aAgent', crewToken: approver, body: { requestId: crypto.randomUUID(), name: 'supplier', cardUrl, credential: { kind: 'bearer', token: 'tok-1' }, ownerShipId: owner, scopes: [], ...change } });
}

/** The proxy ship's statement as a fleet ship discovers it, once its crew stated one. */
async function statementOf(proxyShipId: string) {
  for (let tries = 0; tries < 50; tries += 1) {
    const found = await fetch(`${setting.fleet.url}/api/v1/ship/discover`, { headers: { authorization: `Bearer ${caller}` } });
    const statement = discoverOutputSchema.parse(await found.json()).ships.find(({ id }) => id === proxyShipId)?.statement;
    if (statement?.by === 'crew') {
      return statement;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The proxy ship was never stated');
}

describe('an approver adds an outside A2A agent by its card address (slice 5)', () => {
  it('commissions an a2a-agent proxy ship owned as chosen, its credential never answered', async () => {
    const added = await addAgent();
    expect(added.status, await added.clone().text()).toBe(200);
    const party = addedSchema.parse(await added.json()).result.data;

    const ship = await fetch(`${setting.fleet.url}/api/v1/fleet/ship`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${approver}` }, body: JSON.stringify({ shipId: party.proxyShipId }) });
    const detail = await (await query(setting.address, { procedure: 'parties.get', cookie: setting.cookie, input: { name: 'supplier' } })).text();

    expect(await ship.json()).toMatchObject({ name: 'supplier', type: 'a2a-agent', kind: 'app' });
    expect(party).toMatchObject({ kind: 'a2aAgent', cardUrl, credentialKind: 'bearer', isRepeatable: true });
    expect(JSON.parse(detail)).toMatchObject({ result: { data: { kind: 'a2aAgent', state: 'crewed', ownerShipId: owner } } });
    expect(detail).not.toContain('tok-1');
  });

  it("states the card's skills as the proxy ship's capabilities, repeatable, without its interfaces", async () => {
    const { proxyShipId } = addedSchema.parse(await (await addAgent()).json()).result.data;

    const statement = await statementOf(proxyShipId);

    expect(statement.summary).toBe('supplier, an outside A2A agent reached through the Aeolus gateway: Quotes and books parts.');
    expect(statement.capabilities.map(({ name, title, inputModes, outputModes, repeatable }) => ({ name, title, inputModes, outputModes, repeatable }))).toEqual([
      { name: 'quote', title: 'Quote a price', inputModes: ['text/plain'], outputModes: ['application/json'], repeatable: true },
      { name: 'book', title: 'Book parts', inputModes: ['application/json'], outputModes: ['application/json'], repeatable: true },
    ]);
    expect(JSON.stringify(statement)).not.toContain('agent.supplier.example');
  });

  it('marks the agent not repeatable, and the fleet sees every capability so at once (A9)', async () => {
    const { proxyShipId } = addedSchema.parse(await (await addAgent()).json()).result.data;
    await statementOf(proxyShipId);

    const marked = await mutate(setting.address, { procedure: 'parties.markA2aAgent', crewToken: approver, body: { name: 'supplier', isRepeatable: false } });

    expect(await marked.json()).toMatchObject({ result: { data: { isRepeatable: false, statementRefusal: null } } });
    expect((await statementOf(proxyShipId)).capabilities.map(({ repeatable }) => repeatable)).toEqual([undefined, undefined]);
  });

  it('adds nothing for a card that makes no valid statement, saying why, and commissions no ship', async () => {
    served = { ...CARD, skills: [] };

    const added = await addAgent();
    const listed = await (await query(setting.address, { procedure: 'parties.list', cookie: setting.cookie })).json();

    expect({ status: added.status, says: (await added.text()).includes('no skill') }).toEqual({ status: 400, says: true });
    expect(listed).toMatchObject({ result: { data: [] } });
  });

  it('adds nothing for an address that answers no card, and nothing for one where nothing answers', async () => {
    served = '<html>hello</html>';
    const notACard = await addAgent();
    const unreachable = await addAgent({ cardUrl: 'http://127.0.0.1:1/.well-known/agent-card.json' });

    expect({ notACard: notACard.status, unreachable: unreachable.status }).toEqual({ notACard: 400, unreachable: 502 });
  });
});
