import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { CRM_SHIP_ID, aDiscoveredShip, fakeDiscovery } from '../../../test/support/mcp-in-fakes.js';
import { ISSUER, fakeSecrets } from '../../../test/support/oauth-fakes.js';
import { PROXY_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import { createAuthenticateA2aClient } from '../../core/a2a-in/authenticate-a2a-client.js';
import { createFindReachedShip } from '../../core/a2a-in/find-reached-ship.js';
import { createListReachedShips } from '../../core/a2a-in/list-reached-ships.js';
import { createShipAliases } from '../crypto/ship-aliases.js';
import { registerA2aEndpoint } from './a2a-endpoint.js';

const AT = new Date('2026-10-23T10:00:00.000Z');
const aliases = createShipAliases('gateway-secret');
const CRM_ALIAS = aliases.aliasOf(FLEET_ID, CRM_SHIP_ID);
/** A well-formed alias of no ship. */
const NO_SHIP_ALIAS = 'azzzzzzz';
const BEARER = { authorization: 'Bearer bearer-1' };
const GET_EXTENDED_CARD = { jsonrpc: '2.0', id: 1, method: 'GetExtendedAgentCard', params: {} };

let server: FastifyInstance;
let isOn: boolean;
let discovery: ReturnType<typeof fakeDiscovery>;

beforeEach(async () => {
  isOn = true;
  const parties = memoryPartyStore();
  await parties.save({ fleetId: FLEET_ID, name: 'supplier', kind: 'a2aClient', bearerHash: 'hash(bearer-1)', state: 'crewed', proxyShipId: PROXY_SHIP_ID, secret: null, crewToken: 'aeolus_ct_v1_proxy', requestId: 'r-1', requestHash: 'h', approvedAt: AT });
  discovery = fakeDiscovery();
  server = Fastify();
  registerA2aEndpoint(server, {
    issuer: ISSUER,
    authenticate: createAuthenticateA2aClient({ parties, secrets: fakeSecrets(), servesOutsideParties: () => Promise.resolve(isOn) }),
    findReachedShip: createFindReachedShip({ listReachedShips: createListReachedShips({ parties, discovery, aliases }) }),
  });
  await server.ready();
});

afterEach(async () => {
  await server.close();
});

const extendedCard = (alias: string, headers: Record<string, string> = BEARER) => server.inject({ method: 'POST', url: `/gw/a2a/${alias}`, headers: { ...headers, 'a2a-version': '1.0' }, payload: GET_EXTENDED_CARD });

describe('the public card per alias (decision 0060)', () => {
  it('names the gateway as provider and states the interface, the bearer scheme and an extended card, with no summary and no skills', async () => {
    const answered = await server.inject({ method: 'GET', url: `/gw/a2a/${CRM_ALIAS}/.well-known/agent-card.json` });

    expect(answered.statusCode).toBe(200);
    expect(answered.json()).toMatchObject({
      name: CRM_ALIAS,
      supportedInterfaces: [{ url: `${ISSUER}/gw/a2a/${CRM_ALIAS}`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
      provider: { organization: 'Aeolus gateway', url: ISSUER },
      capabilities: { extendedAgentCard: true },
      securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: 'Bearer' } } },
      securityRequirements: [{ schemes: { bearer: { list: [] } } }],
    });
    expect(answered.json()).not.toHaveProperty('skills');
    expect(JSON.stringify(answered.json())).not.toContain('The CRM');
  });

  it('is served the same for an alias of no ship, so it tells nothing', async () => {
    const [crm, none] = await Promise.all([CRM_ALIAS, NO_SHIP_ALIAS].map((alias) => server.inject({ method: 'GET', url: `/gw/a2a/${alias}/.well-known/agent-card.json` })));

    expect(none?.json()).toEqual({ ...crm?.json(), name: NO_SHIP_ALIAS, supportedInterfaces: [{ url: `${ISSUER}/gw/a2a/${NO_SHIP_ALIAS}`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }] });
  });

  it('is not found for a path that is no alias', async () => {
    const answered = await server.inject({ method: 'GET', url: '/gw/a2a/CRM/.well-known/agent-card.json' });

    expect(answered.statusCode).toBe(404);
  });
});

describe('GetExtendedAgentCard (decision 0060)', () => {
  it("answers the statement of a reachable alias's ship for that caller: its summary, its capabilities as skills", async () => {
    const answered = await extendedCard(CRM_ALIAS);

    expect(answered.statusCode).toBe(200);
    expect(answered.json()).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        name: CRM_ALIAS,
        description: 'The CRM: contacts and deals.',
        skills: [
          {
            id: 'list_deals',
            name: 'List deals',
            description: "Lists a contact's deals.",
            inputModes: ['application/vnd.aeolus.mcp-tool+json; name=list_deals'],
            outputModes: ['application/vnd.aeolus.mcp-result+json; name=list_deals'],
          },
        ],
      },
    });
    expect(discovery.askedWith).toEqual(['aeolus_ct_v1_proxy']);
  });

  it('answers the unknown-alias error for an alias of no ship', async () => {
    const answered = await extendedCard(NO_SHIP_ALIAS);

    expect(answered.statusCode).toBe(404);
  });

  it('answers the same for an alias of a ship the caller cannot reach now', async () => {
    discovery.state.ships = [];
    const [unreachable, none] = [await extendedCard(CRM_ALIAS), await extendedCard(NO_SHIP_ALIAS)];

    expect({ status: unreachable.statusCode, body: unreachable.body }).toEqual({ status: none.statusCode, body: none.body });
  });

  it('refuses a call with no bearer, saying it takes one', async () => {
    const answered = await extendedCard(CRM_ALIAS, {});

    expect(answered.statusCode).toBe(401);
    expect(answered.headers['www-authenticate']).toBe('Bearer');
  });

  it('refuses a bearer no client was shown', async () => {
    const answered = await extendedCard(CRM_ALIAS, { authorization: 'Bearer bearer-2' });

    expect(answered.statusCode).toBe(401);
  });

  it("refuses every call while the fleet's outside parties are off", async () => {
    isOn = false;

    const answered = await extendedCard(CRM_ALIAS);

    expect(answered.statusCode).toBe(403);
    expect(discovery.askedWith).toEqual([]);
  });

  it('answers a fleet that does not answer as a bad gateway', async () => {
    discovery.state.refusal = { code: 'UNAVAILABLE', message: 'down' };

    const answered = await extendedCard(CRM_ALIAS);

    expect(answered.statusCode).toBe(502);
  });

  it("answers a ship with no crew's statement with the public card's description and no skills", async () => {
    discovery.state.ships = [aDiscoveredShip({ statement: null })];

    const answered = await extendedCard(CRM_ALIAS);

    expect(answered.json()).toMatchObject({ result: { name: CRM_ALIAS } });
    expect(answered.json()).not.toHaveProperty('result.skills');
  });

  it('answers an A2A method this gateway does not carry yet as an unsupported operation', async () => {
    const answered = await server.inject({ method: 'POST', url: `/gw/a2a/${CRM_ALIAS}`, headers: { ...BEARER, 'a2a-version': '1.0' }, payload: { jsonrpc: '2.0', id: 2, method: 'GetTask', params: { id: 'task-1' } } });

    expect(answered.json()).toMatchObject({ jsonrpc: '2.0', id: 2, error: { code: -32004 } });
  });
});
