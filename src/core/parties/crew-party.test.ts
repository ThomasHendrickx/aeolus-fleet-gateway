import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { plainHasher } from '../../../test/support/memory-installation.js';
import { fakeSecrets, memoryIssuedTokens, memoryOAuthClients, RESOURCE } from '../../../test/support/oauth-fakes.js';
import { OWNER_SHIP_ID, PROXY_SHIP_ID, fakeProxyShipFleet, memoryPartyStore } from '../../../test/support/party-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { createAddClientParty } from './add-client-party.js';
import { createApproveClientParty, createApproveParty } from './approve-party.js';
import { createCrewParty } from './crew-party.js';

/** Outside parties are on for every fleet here. */
const isServing = () => Promise.resolve(true);

const AT = new Date('2026-10-18T13:00:00.000Z');

let fleet: ReturnType<typeof fakeProxyShipFleet>;
let parties: ReturnType<typeof memoryPartyStore>;
let crewParty: ReturnType<typeof createCrewParty>;
let clients: ReturnType<typeof memoryOAuthClients>;
let tokens: ReturnType<typeof memoryIssuedTokens>;
let secrets: ReturnType<typeof fakeSecrets>;

beforeEach(async () => {
  clients = memoryOAuthClients();
  tokens = memoryIssuedTokens();
  secrets = fakeSecrets();
  fleet = fakeProxyShipFleet();
  parties = memoryPartyStore();
  const connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: AT });
  const approve = createApproveParty({ connections, parties, door: fleet.door, hasher: plainHasher, servesOutsideParties: isServing, clock: { now: () => AT } });
  fleet.state.isLosingNextAnswer = true;
  const approval = { operatorFleetId: FLEET_ID, requestId: 'a-1', name: 'crm', url: 'https://crm.example.com/mcp', credential: { kind: 'bearer' as const, token: 't' }, ownerShipId: OWNER_SHIP_ID, scopes: [], concurrencyLimit: 4, toolSwitches: null };
  await approve(approval);
  await approve(approval);
  crewParty = createCrewParty({ parties, door: fleet.door, clients, secrets, tokens });
});

describe('argo hands over a new secret for a proxy ship awaiting crew (orchestrator-1 on aeolus-fleet#876, Q6)', () => {
  it('crews the ship with it, keeping the crew token', async () => {
    fleet.state.secrets.set(PROXY_SHIP_ID, 'aeolus_sk_v1_new');

    await expect(crewParty({ operatorFleetId: FLEET_ID, name: 'crm', secret: 'aeolus_sk_v1_new' })).resolves.toMatchObject({ isOk: true, value: { party: { state: 'crewed' }, clientSecret: null } });
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

describe('an actor holding fleet:manage gives a client party a new secret (vendor platforms V8)', () => {
  const APPROVER: Actor = { fleetId: FLEET_ID, kind: 'ship', shipId: SHIP_ID, scopes: ['gateway:approve'] };

  beforeEach(async () => {
    const connections = memoryConnectionStore();
    await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: AT });
    fleet = fakeProxyShipFleet();
    parties = memoryPartyStore();
    const approveClientParty = createApproveClientParty({ connections, parties, door: fleet.door, hasher: plainHasher, servesOutsideParties: isServing, clock: { now: () => AT } });
    await createAddClientParty({ parties, approveClientParty, clients, secrets })({ actor: APPROVER, requestId: 'r-1', name: 'agentcore', ownerShipId: OWNER_SHIP_ID, scopes: [] });
    await tokens.save({ familyId: 'f', codeHash: null, fleetId: FLEET_ID, clientId: 'client-secret-1', resource: RESOURCE, scope: null, kind: 'party', party: 'agentcore', accessHash: 'hash(old-access)', accessExpiresAt: new Date('2026-10-18T14:00:00.000Z'), refreshHash: null, refreshExpiresAt: null });
    crewParty = createCrewParty({ parties, door: fleet.door, clients, secrets, tokens });
    fleet.release(PROXY_SHIP_ID, 'aeolus_sk_v1_new');
  });

  it('crews the same proxy ship again once the fleet released its crew', async () => {
    await expect(crewParty({ operatorFleetId: FLEET_ID, name: 'agentcore', secret: 'aeolus_sk_v1_new' })).resolves.toMatchObject({ isOk: true, value: { party: { state: 'crewed', proxyShipId: PROXY_SHIP_ID } } });
    await expect(parties.find(FLEET_ID, 'agentcore')).resolves.toMatchObject({ state: 'crewed', proxyShipId: PROXY_SHIP_ID, clientId: 'client-secret-1' });
  });

  it('answers a new client secret once, and keeps only its hash in place of the old one', async () => {
    await expect(crewParty({ operatorFleetId: FLEET_ID, name: 'agentcore', secret: 'aeolus_sk_v1_new' })).resolves.toMatchObject({ isOk: true, value: { clientSecret: 'secret-3' } });
    expect(clients.held.get('client-secret-1')).toMatchObject({ secretHash: 'hash(secret-3)', grant: 'clientCredentials' });
  });

  it("revokes the party's tokens: they were issued for the old secret", async () => {
    await crewParty({ operatorFleetId: FLEET_ID, name: 'agentcore', secret: 'aeolus_sk_v1_new' });

    expect(tokens.held.map((token) => token.state)).toEqual(['revoked']);
  });

  it('refuses while the fleet still takes its crew token: the crew was not released, and the secret stays', async () => {
    fleet.state.crewed.add(PROXY_SHIP_ID);

    await expect(crewParty({ operatorFleetId: FLEET_ID, name: 'agentcore', secret: 'aeolus_sk_v1_new' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_AWAITING_CREW' } });
    expect(clients.held.get('client-secret-1')?.secretHash).toBe('hash(secret-2)');
  });

  it('refuses a secret the fleet refuses, and the client secret stays', async () => {
    await expect(crewParty({ operatorFleetId: FLEET_ID, name: 'agentcore', secret: 'aeolus_sk_v1_wrong' })).resolves.toMatchObject({ isOk: false, error: { kind: 'SECRET_REFUSED' } });
    expect(clients.held.get('client-secret-1')?.secretHash).toBe('hash(secret-2)');
  });
});

describe("a client party whose commission's answer was lost gets its secret from parties.crew (vendor platforms V4)", () => {
  it('crews the ship awaiting crew with the secret of its new starting prompt, and answers the first client secret', async () => {
    const connections = memoryConnectionStore();
    await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: AT });
    fleet = fakeProxyShipFleet();
    parties = memoryPartyStore();
    const approveClientParty = createApproveClientParty({ connections, parties, door: fleet.door, hasher: plainHasher, servesOutsideParties: isServing, clock: { now: () => AT } });
    fleet.state.isLosingNextAnswer = true;
    const add = createAddClientParty({ parties, approveClientParty, clients, secrets });
    const addition = { actor: { fleetId: FLEET_ID, kind: 'ship' as const, shipId: SHIP_ID, scopes: ['gateway:approve'] }, requestId: 'r-1', name: 'agentcore', ownerShipId: OWNER_SHIP_ID, scopes: [] };
    await add(addition);
    // The approver adds it again, as after a fleet that did not answer: the ship is commissioned, its secret lost.
    await add(addition);
    fleet.state.secrets.set(PROXY_SHIP_ID, 'aeolus_sk_v1_new');

    await expect(createCrewParty({ parties, door: fleet.door, clients, secrets, tokens })({ operatorFleetId: FLEET_ID, name: 'agentcore', secret: 'aeolus_sk_v1_new' })).resolves.toMatchObject({
      isOk: true,
      value: { party: { state: 'crewed' }, clientSecret: 'secret-2' },
    });
    expect(clients.held.get('client-secret-1')?.secretHash).toBe('hash(secret-2)');
  });
});
