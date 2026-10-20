import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { plainHasher } from '../../../test/support/memory-installation.js';
import { OWNER_SHIP_ID, PROXY_SHIP_ID, fakeProxyShipFleet, memoryPartyStore } from '../../../test/support/party-fakes.js';
import { createApproveClientParty } from './approve-party.js';

const AT = new Date('2026-10-19T10:00:00.000Z');
const CLAUDE = 'https://claude.example.com/oauth/client.json';

let fleet: ReturnType<typeof fakeProxyShipFleet>;
let parties: ReturnType<typeof memoryPartyStore>;
let connections: ReturnType<typeof memoryConnectionStore>;
let approve: ReturnType<typeof createApproveClientParty>;

beforeEach(async () => {
  fleet = fakeProxyShipFleet();
  parties = memoryPartyStore();
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: AT });
  approve = createApproveClientParty({ connections, parties, door: fleet.door, hasher: plainHasher, clock: { now: () => AT } });
});

function anApproval(overrides: Partial<Parameters<typeof approve>[0]> = {}): Parameters<typeof approve>[0] {
  return { operatorFleetId: FLEET_ID, requestId: 'r-1', name: 'claude', clientId: CLAUDE, ownerShipId: OWNER_SHIP_ID, scopes: [], ...overrides };
}

describe('argo approves an outside MCP client as a party, at its first authorization (interop I-5)', () => {
  it('commissions its app proxy ship of type mcp-client with the owner argo picked, under the approval as its key', async () => {
    await approve(anApproval());

    expect(fleet.state.commissioned).toEqual([{ name: 'claude', type: 'mcp-client', owner: OWNER_SHIP_ID, idempotencyKey: 'r-1', scopes: [] }]);
  });

  it('crews the proxy ship and keeps its crew token with the client id', async () => {
    await expect(approve(anApproval())).resolves.toEqual({
      isOk: true,
      value: { name: 'claude', kind: 'mcpClient', clientId: CLAUDE, ownerShipId: OWNER_SHIP_ID, state: 'crewed', proxyShipId: PROXY_SHIP_ID },
    });
    await expect(parties.findByClient(FLEET_ID, CLAUDE)).resolves.toMatchObject({ name: 'claude', state: 'crewed', crewToken: 'aeolus_ct_v1_proxy' });
  });

  it('answers a repeated approval with the party, commissioning nothing again', async () => {
    await approve(anApproval());

    await expect(approve(anApproval())).resolves.toMatchObject({ isOk: true, value: { state: 'crewed' } });
    expect(fleet.state.commissioned).toHaveLength(1);
  });

  it('refuses a name another party holds', async () => {
    await approve(anApproval());

    await expect(approve(anApproval({ requestId: 'r-2', clientId: 'client-cursor' }))).resolves.toMatchObject({ isOk: false, error: { kind: 'PARTY_EXISTS' } });
  });

  it('refuses a second party for a client that has one', async () => {
    await approve(anApproval());

    await expect(approve(anApproval({ requestId: 'r-2', name: 'claude-2' }))).resolves.toMatchObject({ isOk: false, error: { kind: 'CLIENT_HAS_PARTY' } });
    expect(fleet.state.commissioned).toHaveLength(1);
  });

  it('refuses while the gateway is not connected to the fleet, keeping nothing', async () => {
    await connections.drop(FLEET_ID);

    await expect(approve(anApproval())).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
    expect(parties.held.size).toBe(0);
  });
});
