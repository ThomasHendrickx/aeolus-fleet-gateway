import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, memoryConnectionStore, SHIP_ID } from '../../../test/support/fleet-fakes.js';
import { fakeMcpServers, fakeStatementDoor, memoryToolMarks } from '../../../test/support/mcp-out-fakes.js';
import { OWNER_SHIP_ID, PROXY_SHIP_ID, fakeProxyShipsAsActor, memoryPartyStore, memoryScopeRequirements } from '../../../test/support/party-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { createCredentialOf } from '../actors/credential-of.js';
import { createStateParty } from '../mcp-out/state-party.js';
import { err } from '../shared/result.js';
import type { McpServerParty } from './party.js';
import { createSwitchTools } from './switch-tools.js';

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
let build: (fleet: ReturnType<typeof fakeProxyShipsAsActor>) => ReturnType<typeof createSwitchTools>;
let switchTools: (input: Omit<Parameters<ReturnType<typeof createSwitchTools>>[0], 'as'>) => ReturnType<ReturnType<typeof createSwitchTools>>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(CRM);
  servers = fakeMcpServers();
  door = fakeStatementDoor();
  const stateParty = createStateParty({ parties, servers, door, marks: memoryToolMarks(), requirements: memoryScopeRequirements(), timing: { waitMs: 10_000, deadlineMs: 300_000 } });
  const connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: new Date('2026-10-25T09:00:00.000Z') });
  build = (fleet) => createSwitchTools({ parties, servers, stateParty, connections, fleet, credentialOf: createCredentialOf({ connections }) });
  const fleet = fakeProxyShipsAsActor();
  switchTools = (input) => build(fleet)({ ...input, as: {} });
});

const stated = () => door.stated.at(-1)?.statement.capabilities.map((capability) => capability.name);
const switchesOf = async (name: string) => {
  const party = await parties.find(FLEET_ID, name);
  return party?.kind === 'mcpServer' ? party.toolSwitches : undefined;
};

describe("an approver switches tools of an outside MCP server on or off (aeolus-fleet#1151, gateway scopes 4.3)", () => {
  it('switches a tool off, and the fleet sees it no more at once', async () => {
    await expect(switchTools({ actor: APPROVER, name: 'crm', tools: ['create_deal'], isOn: false })).resolves.toEqual({ isOk: true, value: { tools: ['create_deal'], isOn: false, statementRefusal: null } });

    expect(stated()).toEqual(['list_contacts']);
    await expect(switchesOf('crm')).resolves.toEqual(new Map([['list_contacts', true], ['create_deal', false]]));
  });

  it('switches on a tool the server listed after its switches were kept', async () => {
    await parties.save({ ...CRM, name: 'erp', toolSwitches: new Map([['list_contacts', true]]) });

    await switchTools({ actor: APPROVER, name: 'erp', tools: ['create_deal'], isOn: true });

    expect(stated()).toEqual(['list_contacts', 'create_deal']);
  });

  it('leaves every other tool on when it switches one of a party with no switches kept', async () => {
    await parties.save({ ...CRM, name: 'old', toolSwitches: null });

    await switchTools({ actor: APPROVER, name: 'old', tools: ['list_contacts'], isOn: false });

    await expect(switchesOf('old')).resolves.toEqual(new Map([['list_contacts', false], ['create_deal', true]]));
  });

  it('keeps the switch while the proxy ship cannot be stated, and says why', async () => {
    door.state.refusal = { code: 'UNAVAILABLE', message: 'The fleet did not answer' };

    await expect(switchTools({ actor: APPROVER, name: 'crm', tools: ['create_deal'], isOn: false })).resolves.toEqual({
      isOk: true,
      value: { tools: ['create_deal'], isOn: false, statementRefusal: 'The fleet refused the statement: The fleet did not answer' },
    });
    await expect(switchesOf('crm')).resolves.toEqual(new Map([['list_contacts', true], ['create_deal', false]]));
  });

  it('refuses an actor without gateway:approve, switching nothing', async () => {
    await expect(switchTools({ actor: { ...APPROVER, scopes: ['fleet:read', 'fleet:manage'] }, name: 'crm', tools: ['create_deal'], isOn: false })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_AN_APPROVER' } });
    await expect(switchesOf('crm')).resolves.toEqual(CRM.toolSwitches);
  });

  it("refuses an approver outside the proxy ship's manage reach, switching nothing", async () => {
    const switched = await build(fakeProxyShipsAsActor(err({ code: 'FORBIDDEN', message: 'You do not manage crm' })))({ actor: APPROVER, as: {}, name: 'crm', tools: ['create_deal'], isOn: false });

    expect(switched).toEqual({ isOk: false, error: { kind: 'NOT_REACHABLE', message: 'You do not manage crm' } });
    await expect(switchesOf('crm')).resolves.toEqual(CRM.toolSwitches);
    expect(door.stated).toEqual([]);
  });

  it('refuses while the fleet does not answer whether the approver manages the proxy ship, switching nothing', async () => {
    const switched = await build(fakeProxyShipsAsActor(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' })))({ actor: APPROVER, as: {}, name: 'crm', tools: ['create_deal'], isOn: false });

    expect(switched).toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
    await expect(switchesOf('crm')).resolves.toEqual(CRM.toolSwitches);
  });

  it('switches every tool selected in one change, stating the proxy ship once', async () => {
    await expect(switchTools({ actor: APPROVER, name: 'crm', tools: ['list_contacts', 'create_deal'], isOn: false })).resolves.toEqual({ isOk: true, value: { tools: ['list_contacts', 'create_deal'], isOn: false, statementRefusal: null } });

    expect(door.stated).toHaveLength(1);
    expect(stated()).toEqual([]);
    await expect(switchesOf('crm')).resolves.toEqual(new Map([['list_contacts', false], ['create_deal', false]]));
  });

  it('refuses the whole selection when one tool is not listed now, naming it and switching none', async () => {
    await expect(switchTools({ actor: APPROVER, name: 'crm', tools: ['create_deal', 'delete_project', 'merge_projects'], isOn: false })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'NO_SUCH_TOOL', message: 'The MCP server of crm lists no tool delete_project or merge_projects now' },
    });
    await expect(switchesOf('crm')).resolves.toEqual(CRM.toolSwitches);
    expect(door.stated).toEqual([]);
  });

  it('refuses a tool the server does not list now', async () => {
    await expect(switchTools({ actor: APPROVER, name: 'crm', tools: ['delete_project'], isOn: true })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_TOOL' } });
    await expect(switchesOf('crm')).resolves.toEqual(CRM.toolSwitches);
  });

  it('refuses while the server cannot be listed, switching nothing', async () => {
    servers.state.isReachable = false;

    await expect(switchTools({ actor: APPROVER, name: 'crm', tools: ['create_deal'], isOn: false })).resolves.toMatchObject({ isOk: false, error: { kind: 'SERVER_UNREACHABLE' } });
  });

  it('refuses a party that is no outside MCP server of the fleet', async () => {
    await expect(switchTools({ actor: APPROVER, name: 'notion', tools: ['create_deal'], isOn: false })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_PARTY' } });
  });
});
