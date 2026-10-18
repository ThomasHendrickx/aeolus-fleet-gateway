import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { ARGO_SHIP_ID, aDiscoveredShip, fakeAliases, fakeDiscovery } from '../../../test/support/mcp-in-fakes.js';
import { OWNER_SHIP_ID, PROXY_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import type { McpClientParty } from '../parties/party.js';
import { createListTools, IDEMPOTENCY_ARGUMENT } from './list-tools.js';

const CLAUDE: McpClientParty = {
  fleetId: FLEET_ID,
  name: 'claude',
  kind: 'mcpClient',
  clientId: 'https://claude.example.com/client.json',
  ownerShipId: OWNER_SHIP_ID,
  state: 'crewed',
  proxyShipId: PROXY_SHIP_ID,
  secret: null,
  crewToken: 'aeolus_ct_v1_claude',
  requestId: 'r-1',
  requestHash: 'h',
  approvedAt: new Date('2026-10-19T10:00:00.000Z'),
};

const CALLER = { fleetId: FLEET_ID, party: 'claude' };

let parties: ReturnType<typeof memoryPartyStore>;
let discovery: ReturnType<typeof fakeDiscovery>;
let listTools: ReturnType<typeof createListTools>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(CLAUDE);
  discovery = fakeDiscovery();
  listTools = createListTools({ parties, discovery, aliases: fakeAliases });
});

async function toolsListed() {
  const listed = await listTools(CALLER);
  return listed.isOk ? listed.value : [];
}

describe("an MCP client's tools are the capabilities of the ships its party reaches (interop 3.3)", () => {
  it('discovers as the party\'s proxy ship, with its crew token', async () => {
    await listTools(CALLER);

    expect(discovery.askedWith).toEqual(['aeolus_ct_v1_claude']);
  });

  it("lists each capability as a tool named by the ship's alias, never its name, with its MCP fields", async () => {
    await expect(toolsListed()).resolves.toEqual([
      {
        name: 'aacr2__list_deals',
        title: 'List deals',
        description: "Lists a contact's deals.\n\nOffered by: The CRM: contacts and deals.",
        inputSchema: {
          type: 'object',
          properties: {
            contactId: { type: 'string' },
            [IDEMPOTENCY_ARGUMENT]: { type: 'string', description: 'Optional. The same key again sends no second message: give one when you may call again after a lost answer.' },
          },
          required: ['contactId'],
        },
        outputSchema: { type: 'object', properties: { deals: { type: 'array' } } },
        target: { shipId: 'shp_01m3tbfspe96yf1rnr4ank9cr2', capability: 'list_deals', contentType: 'application/vnd.aeolus.mcp-tool+json; name=list_deals', isText: false },
      },
    ]);
  });

  it('takes a capability with no input schema as one with any arguments', async () => {
    discovery.state.ships = [aDiscoveredShip({ statement: { by: 'crew', summary: 's', capabilities: [{ name: 'ping' }] } })];

    await expect(toolsListed()).resolves.toMatchObject([{ name: 'aacr2__ping', inputSchema: { type: 'object', properties: { [IDEMPOTENCY_ARGUMENT]: { type: 'string' } } }, target: { contentType: 'application/json', isText: false } }]);
  });

  it('gives a capability that takes plain text one text argument (orchestrator-1 on aeolus-fleet#877, Q14)', async () => {
    discovery.state.ships = [aDiscoveredShip({ statement: { by: 'crew', summary: 's', capabilities: [{ name: 'ask', inputModes: ['text/plain', 'application/json'] }] } })];

    await expect(toolsListed()).resolves.toMatchObject([
      { inputSchema: { type: 'object', properties: { text: { type: 'string' }, [IDEMPOTENCY_ARGUMENT]: { type: 'string' } }, required: ['text'] }, target: { contentType: 'text/plain', isText: true } },
    ]);
  });

  it.each([
    ['argo, though every ship may send to argo (Q12)', aDiscoveredShip({ shipId: ARGO_SHIP_ID, kind: 'operator' })],
    ['a ship with no statement', aDiscoveredShip({ statement: null })],
    ['a ship with only its commission note', aDiscoveredShip({ statement: { by: 'commission' } })],
    ['a capability whose first input type is neither JSON nor text', aDiscoveredShip({ statement: { by: 'crew', summary: 's', capabilities: [{ name: 'scan', inputModes: ['image/png'] }] } })],
    ['a capability whose input schema is not an object', aDiscoveredShip({ statement: { by: 'crew', summary: 's', capabilities: [{ name: 'count', inputSchema: { type: 'number' } }] } })],
    ['a capability whose tool name would pass 128 characters', aDiscoveredShip({ statement: { by: 'crew', summary: 's', capabilities: [{ name: 'x'.repeat(122) }] } })],
  ])('leaves out %s', async (_what, ship) => {
    discovery.state.ships = [ship];

    await expect(toolsListed()).resolves.toEqual([]);
  });

  it('takes a tool name of exactly 128 characters', async () => {
    discovery.state.ships = [aDiscoveredShip({ statement: { by: 'crew', summary: 's', capabilities: [{ name: 'x'.repeat(121) }] } })];

    await expect(toolsListed().then((tools) => tools.map((tool) => tool.name.length))).resolves.toEqual([128]);
  });

  it('leaves out an output schema a JSON result type does not carry', async () => {
    discovery.state.ships = [aDiscoveredShip({ statement: { by: 'crew', summary: 's', capabilities: [{ name: 'say', outputSchema: { type: 'object' }, outputModes: ['text/plain'] }] } })];

    await expect(toolsListed().then((tools) => tools[0]?.outputSchema)).resolves.toBeUndefined();
  });

  it('refuses a party that is not crewed, or not a client', async () => {
    await parties.save({ ...CLAUDE, state: 'awaitingCrew', crewToken: null });

    await expect(listTools(CALLER)).resolves.toMatchObject({ isOk: false, error: { kind: 'PARTY_NOT_CREWED' } });
    await expect(listTools({ fleetId: FLEET_ID, party: 'erp' })).resolves.toMatchObject({ isOk: false, error: { kind: 'PARTY_NOT_CREWED' } });
  });

  it('refuses while the fleet does not answer, saying so', async () => {
    discovery.state.refusal = { code: 'UNAVAILABLE', message: 'The fleet did not answer' };

    await expect(listTools(CALLER)).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});
