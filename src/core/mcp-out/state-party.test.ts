import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeMcpServers, fakeStatementDoor, memoryToolMarks } from '../../../test/support/mcp-out-fakes.js';
import { OWNER_SHIP_ID, PROXY_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import type { Party } from '../parties/party.js';
import { createMarkTool } from './mark-tool.js';
import { createStateParty } from './state-party.js';

const AT = new Date('2026-10-18T14:00:00.000Z');

const CRM: Party = {
  fleetId: FLEET_ID,
  name: 'crm',
  kind: 'mcpServer',
  url: 'https://crm.example.com/mcp',
  credential: { kind: 'bearer', token: 'crm-token' },
  ownerShipId: OWNER_SHIP_ID,
  concurrencyLimit: 4,
  state: 'crewed',
  proxyShipId: PROXY_SHIP_ID,
  secret: null,
  crewToken: 'aeolus_ct_v1_proxy',
  requestId: 'a-1',
  requestHash: 'h',
  approvedAt: AT,
};

let parties: ReturnType<typeof memoryPartyStore>;
let servers: ReturnType<typeof fakeMcpServers>;
let door: ReturnType<typeof fakeStatementDoor>;
let marks: ReturnType<typeof memoryToolMarks>;
let stateParty: ReturnType<typeof createStateParty>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(CRM);
  servers = fakeMcpServers();
  door = fakeStatementDoor();
  marks = memoryToolMarks();
  stateParty = createStateParty({ parties, servers, door, marks });
});

describe('the gateway states what a proxy ship offers, as its crew (decision 0047)', () => {
  it("states the server's tools as the proxy ship, with its crew token", async () => {
    await expect(stateParty({ fleetId: FLEET_ID, name: 'crm' })).resolves.toEqual({ isOk: true, value: { capabilities: ['list_contacts', 'create_deal'] } });
    expect(door.stated.map(({ crewToken, statement }) => [crewToken, statement.capabilities.map((capability) => capability.name)])).toEqual([['aeolus_ct_v1_proxy', ['list_contacts', 'create_deal']]]);
  });

  it('calls the server with the credential from the vault', async () => {
    await stateParty({ fleetId: FLEET_ID, name: 'crm' });

    expect(servers.listedWith).toEqual([{ url: 'https://crm.example.com/mcp', credential: { kind: 'bearer', token: 'crm-token' } }]);
  });

  it('refuses while the server cannot be listed, stating nothing', async () => {
    servers.state.isReachable = false;

    await expect(stateParty({ fleetId: FLEET_ID, name: 'crm' })).resolves.toMatchObject({ isOk: false, error: { kind: 'SERVER_UNREACHABLE' } });
    expect(door.stated).toEqual([]);
  });

  it('refuses when the fleet refuses the statement, saying why', async () => {
    door.state.refusal = { code: 'BAD_REQUEST', message: 'A statement is at most 65536 bytes (64 KB) as JSON in UTF-8' };

    await expect(stateParty({ fleetId: FLEET_ID, name: 'crm' })).resolves.toMatchObject({ isOk: false, error: { kind: 'STATEMENT_REFUSED', message: 'The fleet refused the statement: A statement is at most 65536 bytes (64 KB) as JSON in UTF-8' } });
  });

  it('refuses a party whose proxy ship it does not crew', async () => {
    await parties.save({ ...CRM, state: 'awaitingCrew', crewToken: null });

    await expect(stateParty({ fleetId: FLEET_ID, name: 'crm' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CREWED' } });
  });

  it('refuses a party it does not know', async () => {
    await expect(stateParty({ fleetId: FLEET_ID, name: 'erp' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_PARTY' } });
  });
});

describe("argo marks a tool repeatable (interop 5.2)", () => {
  it('states the mark at once', async () => {
    const markTool = createMarkTool({ parties, marks, stateParty });

    await markTool({ fleetId: FLEET_ID, name: 'crm', tool: 'create_deal', isRepeatable: true });

    expect(door.stated.at(-1)?.statement.capabilities.find((capability) => capability.name === 'create_deal')?.repeatable).toBe(true);
  });

  it('takes the mark off again', async () => {
    const markTool = createMarkTool({ parties, marks, stateParty });
    await markTool({ fleetId: FLEET_ID, name: 'crm', tool: 'create_deal', isRepeatable: true });

    await markTool({ fleetId: FLEET_ID, name: 'crm', tool: 'create_deal', isRepeatable: false });

    expect(door.stated.at(-1)?.statement.capabilities.find((capability) => capability.name === 'create_deal')?.repeatable).toBeUndefined();
  });

  it('keeps the mark while the server cannot be listed, and states it once it can', async () => {
    const markTool = createMarkTool({ parties, marks, stateParty });
    servers.state.isReachable = false;
    await expect(markTool({ fleetId: FLEET_ID, name: 'crm', tool: 'create_deal', isRepeatable: true })).resolves.toMatchObject({ isOk: false, error: { kind: 'SERVER_UNREACHABLE' } });
    servers.state.isReachable = true;

    await stateParty({ fleetId: FLEET_ID, name: 'crm' });

    expect(door.stated.at(-1)?.statement.capabilities.find((capability) => capability.name === 'create_deal')?.repeatable).toBe(true);
  });

  it('refuses a mark for a party it does not know, keeping nothing', async () => {
    const markTool = createMarkTool({ parties, marks, stateParty });

    await expect(markTool({ fleetId: FLEET_ID, name: 'erp', tool: 'x', isRepeatable: true })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_PARTY' } });
    expect(marks.held.size).toBe(0);
  });
});
