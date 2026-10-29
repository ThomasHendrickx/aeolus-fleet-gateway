import { beforeEach, describe, expect, it } from 'vitest';

import { anAgentParty } from '../../../test/support/a2a-agent-fakes.js';
import { FLEET_ID, memoryConnectionStore, SHIP_ID } from '../../../test/support/fleet-fakes.js';
import { fakeProxyShipsAsActor, memoryPartyStore, OWNER_SHIP_ID, PROXY_SHIP_ID } from '../../../test/support/party-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { createCredentialOf } from '../actors/credential-of.js';
import { err } from '../shared/result.js';
import { createCheckApproving } from './check-approving.js';
import type { McpServerParty } from './party.js';

const APPROVER: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-1', personShipId: OWNER_SHIP_ID, accountToken: 'account-token', scopes: ['gateway:approve', 'fleet:read'] };

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
let connections: ReturnType<typeof memoryConnectionStore>;
let checkWith: (fleet: ReturnType<typeof fakeProxyShipsAsActor>) => ReturnType<typeof createCheckApproving>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(CRM);
  await parties.save(anAgentParty());
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: new Date('2026-10-25T09:00:00.000Z') });
  checkWith = (fleet) => createCheckApproving({ parties, connections, fleet, credentialOf: createCredentialOf({ connections }) });
});

describe("whether an actor approves a party: gateway:approve within manage reach of its proxy ship (gateway scopes 4.3, A2)", () => {
  it('answers yes for an approver the fleet says manages the proxy ship, asked as the approver', async () => {
    const fleet = fakeProxyShipsAsActor();

    await expect(checkWith(fleet)({ actor: APPROVER, as: {}, name: 'crm' })).resolves.toEqual({ isOk: true, value: undefined });
    expect(fleet.checked.map(({ shipId }) => shipId)).toEqual([PROXY_SHIP_ID]);
  });

  it('refuses an actor without gateway:approve, asking the fleet nothing', async () => {
    const fleet = fakeProxyShipsAsActor();

    await expect(checkWith(fleet)({ actor: { ...APPROVER, scopes: ['fleet:read'] }, as: {}, name: 'crm' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_AN_APPROVER' } });
    expect(fleet.checked).toEqual([]);
  });

  it("refuses an approver outside the proxy ship's manage reach, in the fleet's words", async () => {
    const fleet = fakeProxyShipsAsActor(err({ code: 'FORBIDDEN', message: 'crm is not within your manage reach' }));

    await expect(checkWith(fleet)({ actor: APPROVER, as: {}, name: 'crm' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_REACHABLE', message: 'crm is not within your manage reach' } });
  });

  it('says the fleet did not answer whether the approver manages the proxy ship', async () => {
    const fleet = fakeProxyShipsAsActor(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }));

    await expect(checkWith(fleet)({ actor: APPROVER, as: {}, name: 'crm' })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });

  it('refuses a party whose proxy ship is not commissioned yet', async () => {
    await parties.save({ ...CRM, name: 'erp', proxyShipId: null });

    await expect(checkWith(fakeProxyShipsAsActor())({ actor: APPROVER, as: {}, name: 'erp' })).resolves.toMatchObject({ isOk: false, error: { kind: 'PARTY_NOT_COMMISSIONED' } });
  });

  it('refuses a name that is no outside MCP server or A2A agent', async () => {
    await expect(checkWith(fakeProxyShipsAsActor())({ actor: APPROVER, as: {}, name: 'notion' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_PARTY' } });
  });
});
