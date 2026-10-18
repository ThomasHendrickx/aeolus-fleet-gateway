import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { plainHasher } from '../../../test/support/memory-installation.js';
import { OWNER_SHIP_ID, PROXY_SHIP_ID, fakeProxyShipFleet, memoryPartyStore } from '../../../test/support/party-fakes.js';
import { createApproveParty } from './approve-party.js';
import { createCrewParty } from './crew-party.js';

const AT = new Date('2026-10-18T13:00:00.000Z');

let fleet: ReturnType<typeof fakeProxyShipFleet>;
let parties: ReturnType<typeof memoryPartyStore>;
let crewParty: ReturnType<typeof createCrewParty>;

beforeEach(async () => {
  fleet = fakeProxyShipFleet();
  parties = memoryPartyStore();
  const connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: AT });
  const approve = createApproveParty({ connections, parties, door: fleet.door, hasher: plainHasher, clock: { now: () => AT } });
  fleet.state.isLosingNextAnswer = true;
  const approval = { operatorFleetId: FLEET_ID, requestId: 'a-1', name: 'crm', url: 'https://crm.example.com/mcp', credential: { kind: 'bearer' as const, token: 't' }, ownerShipId: OWNER_SHIP_ID, concurrencyLimit: 4 };
  await approve(approval);
  await approve(approval);
  crewParty = createCrewParty({ parties, door: fleet.door });
});

describe('argo hands over a new secret for a proxy ship awaiting crew (orchestrator-1 on aeolus-fleet#876, Q6)', () => {
  it('crews the ship with it, keeping the crew token', async () => {
    fleet.state.secrets.set(PROXY_SHIP_ID, 'aeolus_sk_v1_new');

    await expect(crewParty({ operatorFleetId: FLEET_ID, name: 'crm', secret: 'aeolus_sk_v1_new' })).resolves.toMatchObject({ isOk: true, value: { state: 'crewed' } });
    await expect(parties.find(FLEET_ID, 'crm')).resolves.toMatchObject({ state: 'crewed', crewToken: 'aeolus_ct_v1_proxy', secret: null });
  });

  it('refuses a secret the fleet refuses, and keeps the ship awaiting crew', async () => {
    await expect(crewParty({ operatorFleetId: FLEET_ID, name: 'crm', secret: 'aeolus_sk_v1_wrong' })).resolves.toMatchObject({ isOk: false, error: { kind: 'SECRET_REFUSED' } });
    await expect(parties.find(FLEET_ID, 'crm')).resolves.toMatchObject({ state: 'awaitingCrew' });
  });

  it('refuses a party it does not know', async () => {
    await expect(crewParty({ operatorFleetId: FLEET_ID, name: 'erp', secret: 'aeolus_sk_v1_new' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_PARTY' } });
  });

  it('refuses a party it crews already', async () => {
    fleet.state.secrets.set(PROXY_SHIP_ID, 'aeolus_sk_v1_new');
    await crewParty({ operatorFleetId: FLEET_ID, name: 'crm', secret: 'aeolus_sk_v1_new' });

    await expect(crewParty({ operatorFleetId: FLEET_ID, name: 'crm', secret: 'aeolus_sk_v1_new' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_AWAITING_CREW' } });
  });
});
