import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { plainHasher } from '../../../test/support/memory-installation.js';
import { OWNER_SHIP_ID, PROXY_SHIP_ID, fakeProxyShipFleet, memoryPartyStore } from '../../../test/support/party-fakes.js';
import type { McpServerCredential } from '../vault/credential.js';
import { createApproveParty } from './approve-party.js';

const AT = new Date('2026-10-18T13:00:00.000Z');
const CRM_URL = 'https://crm.example.com/mcp';
const BEARER: McpServerCredential = { kind: 'bearer', token: 'crm-token' };

let fleet: ReturnType<typeof fakeProxyShipFleet>;
let parties: ReturnType<typeof memoryPartyStore>;
let connections: ReturnType<typeof memoryConnectionStore>;
let approve: ReturnType<typeof createApproveParty>;

beforeEach(async () => {
  fleet = fakeProxyShipFleet();
  parties = memoryPartyStore();
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: AT });
  approve = createApproveParty({ connections, parties, door: fleet.door, hasher: plainHasher, clock: { now: () => AT } });
});

function anApproval(overrides: Partial<Parameters<typeof approve>[0]> = {}): Parameters<typeof approve>[0] {
  return { operatorFleetId: FLEET_ID, requestId: 'a-1', name: 'crm', url: CRM_URL, credential: BEARER, ownerShipId: OWNER_SHIP_ID, concurrencyLimit: 4, ...overrides };
}

describe('argo approves an outside MCP server as a party (interop I-5)', () => {
  it('commissions its app proxy ship with the owner argo picked, under the approval as its key', async () => {
    await approve(anApproval());

    expect(fleet.state.commissioned).toEqual([{ name: 'crm', type: 'mcp-server', owner: OWNER_SHIP_ID, idempotencyKey: 'a-1' }]);
  });

  it('crews the proxy ship and keeps its crew token and the credential in the vault', async () => {
    await expect(approve(anApproval())).resolves.toMatchObject({ isOk: true, value: { name: 'crm', state: 'crewed', proxyShipId: PROXY_SHIP_ID } });
    await expect(parties.find(FLEET_ID, 'crm')).resolves.toMatchObject({ state: 'crewed', crewToken: 'aeolus_ct_v1_proxy', credential: BEARER, url: CRM_URL, concurrencyLimit: 4 });
  });

  it('answers the party without its credential or crew token', async () => {
    const approved = await approve(anApproval());

    expect(approved.isOk && Object.keys(approved.value).sort()).toEqual(['concurrencyLimit', 'credentialKind', 'kind', 'name', 'ownerShipId', 'proxyShipId', 'state', 'url']);
  });

  it('answers a repeated approval with the party, commissioning nothing again', async () => {
    await approve(anApproval());

    await expect(approve(anApproval())).resolves.toMatchObject({ isOk: true, value: { state: 'crewed', proxyShipId: PROXY_SHIP_ID } });
    expect(fleet.state.commissioned).toHaveLength(1);
  });

  it('refuses another approval for a name a party holds', async () => {
    await approve(anApproval());

    await expect(approve(anApproval({ requestId: 'a-2', url: 'https://other.example.com/mcp' }))).resolves.toMatchObject({ isOk: false, error: { kind: 'PARTY_EXISTS' } });
  });

  it('refuses while the gateway is not connected to the fleet, keeping nothing', async () => {
    await connections.drop(FLEET_ID);

    await expect(approve(anApproval())).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
    expect(parties.held.size).toBe(0);
  });

  it('refuses an owner the fleet refuses, keeping nothing, so argo may approve it again', async () => {
    await expect(approve(anApproval({ ownerShipId: 'shp_01m3tbfspe96yf1rnr4ank9bad' }))).resolves.toMatchObject({ isOk: false, error: { kind: 'COMMISSION_REFUSED' } });
    expect(parties.held.size).toBe(0);
  });
});

describe('an approval the fleet did not answer', () => {
  it('keeps the party commissioning, and the same approval again finishes it with the same key', async () => {
    fleet.state.isAnswering = false;
    await expect(approve(anApproval())).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
    await expect(parties.find(FLEET_ID, 'crm')).resolves.toMatchObject({ state: 'commissioning' });

    fleet.state.isAnswering = true;

    await expect(approve(anApproval())).resolves.toMatchObject({ isOk: true, value: { state: 'crewed' } });
    expect(fleet.state.commissioned).toHaveLength(1);
  });

  it('whose commission was stored and its answer lost leaves the ship awaiting crew: its secret was shown once', async () => {
    fleet.state.isLosingNextAnswer = true;
    await approve(anApproval());

    await expect(approve(anApproval())).resolves.toMatchObject({ isOk: true, value: { state: 'awaitingCrew', proxyShipId: PROXY_SHIP_ID } });
    expect(fleet.state.commissioned).toHaveLength(1);
  });

  it('keeps the secret while its register is not answered, and crews the ship when approved again', async () => {
    const answering = fleet.door.register;
    fleet.door.register = () => Promise.resolve({ isOk: false, error: { code: 'UNAVAILABLE', message: 'The fleet did not answer' } });
    await expect(approve(anApproval())).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
    await expect(parties.find(FLEET_ID, 'crm')).resolves.toMatchObject({ state: 'awaitingCrew', proxyShipId: PROXY_SHIP_ID });
    fleet.door.register = answering;

    await expect(approve(anApproval())).resolves.toMatchObject({ isOk: true, value: { state: 'crewed' } });
    await expect(parties.find(FLEET_ID, 'crm')).resolves.toMatchObject({ secret: null, crewToken: 'aeolus_ct_v1_proxy' });
  });
});
