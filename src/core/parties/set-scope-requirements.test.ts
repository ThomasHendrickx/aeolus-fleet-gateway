import { beforeEach, describe, expect, it } from 'vitest';

import { anAgentParty } from '../../../test/support/a2a-agent-fakes.js';
import { fakeListedScopes, FLEET_ID, memoryConnectionStore, SHIP_ID } from '../../../test/support/fleet-fakes.js';
import { memoryPartyStore, memoryScopeRequirements, OWNER_SHIP_ID, PROXY_SHIP_ID } from '../../../test/support/party-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import type { McpServerParty } from './party.js';
import { createSetScopeRequirements } from './set-scope-requirements.js';

const APPROVER: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-1', personShipId: OWNER_SHIP_ID, accountToken: 'account-token', scopes: ['gateway:approve', 'fleet:read'] };
const GATEWAY_CREW = 'aeolus_ct_v1_gateway';

const CRM: McpServerParty = {
  fleetId: FLEET_ID,
  name: 'crm',
  kind: 'mcpServer',
  url: 'https://crm.example.com/mcp',
  credential: { kind: 'none' },
  concurrencyLimit: 4,
  toolSwitches: null,
  state: 'crewed',
  proxyShipId: PROXY_SHIP_ID,
  secret: null,
  crewToken: 'aeolus_ct_v1_proxy',
  requestId: 'a-1',
  requestHash: 'h',
  approvedAt: new Date('2026-10-18T14:00:00.000Z'),
};

let parties: ReturnType<typeof memoryPartyStore>;
let requirements: ReturnType<typeof memoryScopeRequirements>;
let listed: ReturnType<typeof fakeListedScopes>;
let connections: ReturnType<typeof memoryConnectionStore>;
let setRequirements: ReturnType<typeof createSetScopeRequirements>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(CRM);
  await parties.save(anAgentParty());
  requirements = memoryScopeRequirements();
  listed = fakeListedScopes();
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: GATEWAY_CREW, crewedAt: new Date('2026-10-25T09:00:00.000Z') });
  setRequirements = createSetScopeRequirements({ parties, requirements, connections, door: listed.door });
});

describe('an approver sets which scopes a calling ship needs for a party and its tools (gateway scopes 4.2, A2)', () => {
  it("sets the party's set and a tool's set, kept at the next version", async () => {
    const set = await setRequirements({ actor: APPROVER, name: 'crm', version: 0, party: ['crm:read-leads'], tools: new Map([['update_lead', ['crm:write-leads']]]) });

    const expected = { version: 1, party: ['crm:read-leads'], tools: new Map([['update_lead', ['crm:write-leads']]]) };
    expect(set).toEqual({ isOk: true, value: expected });
    await expect(requirements.find(FLEET_ID, 'crm')).resolves.toEqual(expected);
  });

  it('sets the scopes an A2A agent needs as a whole', async () => {
    await expect(setRequirements({ actor: APPROVER, name: 'supplier', version: 0, party: ['crm:read-leads'], tools: new Map() })).resolves.toMatchObject({ isOk: true, value: { party: ['crm:read-leads'] } });
  });

  it('names a scope given twice in one set once', async () => {
    await setRequirements({ actor: APPROVER, name: 'crm', version: 0, tools: new Map([['update_lead', ['crm:write-leads', 'crm:write-leads']]]) });

    await expect(requirements.find(FLEET_ID, 'crm')).resolves.toMatchObject({ tools: new Map([['update_lead', ['crm:write-leads']]]) });
  });

  it('may require any scope the fleet lists, a plugin\'s among them: no policy (0016)', async () => {
    await expect(setRequirements({ actor: APPROVER, name: 'crm', version: 0, party: ['gateway:approve'], tools: new Map() })).resolves.toMatchObject({ isOk: true });
  });

  it('reads the listed scopes as the gateway\'s own ship', async () => {
    await setRequirements({ actor: APPROVER, name: 'crm', version: 0, party: ['crm:read-leads'], tools: new Map() });

    expect(listed.state.readers).toEqual([GATEWAY_CREW]);
  });

  it('refuses an actor without gateway:approve, changing nothing', async () => {
    const viewer: Actor = { ...APPROVER, scopes: ['fleet:read'] };

    await expect(setRequirements({ actor: viewer, name: 'crm', version: 0, party: ['crm:read-leads'], tools: new Map() })).resolves.toEqual({
      isOk: false,
      error: { kind: 'NOT_AN_APPROVER', message: "Setting the scopes an outside party needs takes gateway:approve" },
    });
    await expect(requirements.find(FLEET_ID, 'crm')).resolves.toMatchObject({ version: 0 });
  });

  it('refuses a party that is neither an outside MCP server nor an A2A agent', async () => {
    await expect(setRequirements({ actor: APPROVER, name: 'claude', version: 0, party: [], tools: new Map() })).resolves.toEqual({
      isOk: false,
      error: { kind: 'NO_SUCH_PARTY', message: 'There is no outside MCP server or A2A agent claude' },
    });
  });

  it("refuses a tool's set for an A2A agent, whose messages name no tool", async () => {
    await expect(setRequirements({ actor: APPROVER, name: 'supplier', version: 0, tools: new Map([['quote', ['crm:read-leads']]]) })).resolves.toEqual({
      isOk: false,
      error: { kind: 'NO_SUCH_TOOL', message: 'supplier is an outside A2A agent: its messages name no tool, so set the scopes it needs as a whole' },
    });
  });

  it('refuses every scope the fleet does not list, by name, changing nothing', async () => {
    await expect(setRequirements({ actor: APPROVER, name: 'crm', version: 0, party: ['crm:admin'], tools: new Map([['update_lead', ['crm:write-leads', 'crm:owner']]]) })).resolves.toEqual({
      isOk: false,
      error: { kind: 'SCOPE_NOT_LISTED', message: 'The fleet lists no scope crm:admin or crm:owner: define it first, or pick a listed one' },
    });
    await expect(requirements.find(FLEET_ID, 'crm')).resolves.toMatchObject({ version: 0 });
  });

  it('refuses a change made on requirements another approver changed since, changing nothing more', async () => {
    await setRequirements({ actor: APPROVER, name: 'crm', version: 0, party: ['crm:read-leads'], tools: new Map() });

    await expect(setRequirements({ actor: APPROVER, name: 'crm', version: 0, party: ['crm:write-leads'], tools: new Map() })).resolves.toEqual({
      isOk: false,
      error: { kind: 'CONFLICT', message: 'The requirements changed since you opened this page' },
    });
    await expect(requirements.find(FLEET_ID, 'crm')).resolves.toMatchObject({ version: 1, party: ['crm:read-leads'] });
  });

  it('refuses while the fleet does not answer which scopes it lists', async () => {
    listed.state.isAnswering = false;

    await expect(setRequirements({ actor: APPROVER, name: 'crm', version: 0, party: ['crm:read-leads'], tools: new Map() })).resolves.toEqual({
      isOk: false,
      error: { kind: 'FLEET_UNAVAILABLE', message: 'The fleet did not say which scopes it lists: The fleet did not answer' },
    });
  });

  it('refuses while the gateway is not connected to the fleet', async () => {
    await connections.drop(FLEET_ID);

    await expect(setRequirements({ actor: APPROVER, name: 'crm', version: 0, party: ['crm:read-leads'], tools: new Map() })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
  });

  it('clears every requirement without asking the fleet: nothing is required', async () => {
    await setRequirements({ actor: APPROVER, name: 'crm', version: 0, party: ['crm:read-leads'], tools: new Map() });
    listed.state.isAnswering = false;

    await expect(setRequirements({ actor: APPROVER, name: 'crm', version: 1, party: [], tools: new Map() })).resolves.toMatchObject({ isOk: true, value: { version: 2, party: [] } });
  });
});
