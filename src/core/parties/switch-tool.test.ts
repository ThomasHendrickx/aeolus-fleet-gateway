import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeMcpServers, fakeStatementDoor, memoryToolMarks } from '../../../test/support/mcp-out-fakes.js';
import { OWNER_SHIP_ID, PROXY_SHIP_ID, memoryPartyStore, memoryScopeRequirements } from '../../../test/support/party-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { createStateParty } from '../mcp-out/state-party.js';
import type { McpServerParty } from './party.js';
import { createSwitchTool } from './switch-tool.js';

const APPROVER: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-1', personShipId: OWNER_SHIP_ID, accountToken: 'account-token', scopes: ['gateway:approve', 'fleet:read'] };

const CRM: McpServerParty = {
  fleetId: FLEET_ID,
  name: 'crm',
  kind: 'mcpServer',
  url: 'https://crm.example.com/mcp',
  credential: { kind: 'none' },
  concurrencyLimit: 4,
  toolSwitches: new Map([['list_contacts', true], ['create_deal', true]]),
  state: 'crewed',
  proxyShipId: PROXY_SHIP_ID,
  secret: null,
  crewToken: 'aeolus_ct_v1_proxy',
  requestId: 'a-1',
  requestHash: 'h',
  approvedAt: new Date('2026-10-18T14:00:00.000Z'),
};

let parties: ReturnType<typeof memoryPartyStore>;
let servers: ReturnType<typeof fakeMcpServers>;
let door: ReturnType<typeof fakeStatementDoor>;
let switchTool: ReturnType<typeof createSwitchTool>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(CRM);
  servers = fakeMcpServers();
  door = fakeStatementDoor();
  const stateParty = createStateParty({ parties, servers, door, marks: memoryToolMarks(), requirements: memoryScopeRequirements(), timing: { waitMs: 10_000, deadlineMs: 300_000 } });
  switchTool = createSwitchTool({ parties, servers, stateParty });
});

const stated = () => door.stated.at(-1)?.statement.capabilities.map((capability) => capability.name);
const switchesOf = async (name: string) => {
  const party = await parties.find(FLEET_ID, name);
  return party?.kind === 'mcpServer' ? party.toolSwitches : undefined;
};

describe("an approver switches a tool of an outside MCP server on or off (aeolus-fleet#1151)", () => {
  it('switches a tool off, and the fleet sees it no more at once', async () => {
    await expect(switchTool({ actor: APPROVER, name: 'crm', tool: 'create_deal', isOn: false })).resolves.toEqual({ isOk: true, value: { tool: 'create_deal', isOn: false, statementRefusal: null } });

    expect(stated()).toEqual(['list_contacts']);
    await expect(switchesOf('crm')).resolves.toEqual(new Map([['list_contacts', true], ['create_deal', false]]));
  });

  it('switches on a tool the server listed after its switches were kept', async () => {
    await parties.save({ ...CRM, name: 'erp', toolSwitches: new Map([['list_contacts', true]]) });

    await switchTool({ actor: APPROVER, name: 'erp', tool: 'create_deal', isOn: true });

    expect(stated()).toEqual(['list_contacts', 'create_deal']);
  });

  it('leaves every other tool on when it switches one of a party with no switches kept', async () => {
    await parties.save({ ...CRM, name: 'old', toolSwitches: null });

    await switchTool({ actor: APPROVER, name: 'old', tool: 'list_contacts', isOn: false });

    await expect(switchesOf('old')).resolves.toEqual(new Map([['list_contacts', false], ['create_deal', true]]));
  });

  it('keeps the switch while the proxy ship cannot be stated, and says why', async () => {
    door.state.refusal = { code: 'UNAVAILABLE', message: 'The fleet did not answer' };

    await expect(switchTool({ actor: APPROVER, name: 'crm', tool: 'create_deal', isOn: false })).resolves.toEqual({
      isOk: true,
      value: { tool: 'create_deal', isOn: false, statementRefusal: 'The fleet refused the statement: The fleet did not answer' },
    });
    await expect(switchesOf('crm')).resolves.toEqual(new Map([['list_contacts', true], ['create_deal', false]]));
  });

  it('refuses an actor without gateway:approve, switching nothing', async () => {
    await expect(switchTool({ actor: { ...APPROVER, scopes: ['fleet:read', 'fleet:manage'] }, name: 'crm', tool: 'create_deal', isOn: false })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_AN_APPROVER' } });
    await expect(switchesOf('crm')).resolves.toEqual(CRM.toolSwitches);
  });

  it('refuses a tool the server does not list now', async () => {
    await expect(switchTool({ actor: APPROVER, name: 'crm', tool: 'delete_project', isOn: true })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_TOOL' } });
    await expect(switchesOf('crm')).resolves.toEqual(CRM.toolSwitches);
  });

  it('refuses while the server cannot be listed, switching nothing', async () => {
    servers.state.isReachable = false;

    await expect(switchTool({ actor: APPROVER, name: 'crm', tool: 'create_deal', isOn: false })).resolves.toMatchObject({ isOk: false, error: { kind: 'SERVER_UNREACHABLE' } });
  });

  it('refuses a party that is no outside MCP server of the fleet', async () => {
    await expect(switchTool({ actor: APPROVER, name: 'notion', tool: 'create_deal', isOn: false })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_PARTY' } });
  });
});
