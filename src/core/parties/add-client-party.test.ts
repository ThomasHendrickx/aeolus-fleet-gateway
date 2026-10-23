import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { plainHasher } from '../../../test/support/memory-installation.js';
import { fakeSecrets, memoryOAuthClients } from '../../../test/support/oauth-fakes.js';
import { OWNER_SHIP_ID, PROXY_SHIP_ID, fakeProxyShipFleet, memoryPartyStore } from '../../../test/support/party-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { createAddClientParty } from './add-client-party.js';
import { createApproveClientParty } from './approve-party.js';

// An actor holding gateway:approve adds a client party with no human at the
// authorize step, as a vendor agent such as AgentCore is (vendor platforms
// V4): its name, its owner (a person ship) and its scopes. The gateway
// commissions and crews its mcp-client proxy ship and answers its client id
// and secret once.

const AT = new Date('2026-10-23T09:00:00.000Z');
const APPROVER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9apr';
const APPROVER_ACTOR: Actor = { fleetId: FLEET_ID, kind: 'ship', shipId: APPROVER, scopes: ['gateway:approve', 'fleet:read'] };

let fleet: ReturnType<typeof fakeProxyShipFleet>;
let parties: ReturnType<typeof memoryPartyStore>;
let clients: ReturnType<typeof memoryOAuthClients>;
/** Whether the fleet's outside parties are on (interop I-3). */
let isOn: boolean;
let addClientParty: ReturnType<typeof createAddClientParty>;

beforeEach(async () => {
  fleet = fakeProxyShipFleet();
  parties = memoryPartyStore();
  clients = memoryOAuthClients();
  isOn = true;
  const connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: AT });
  const approveClientParty = createApproveClientParty({ connections, parties, door: fleet.door, hasher: plainHasher, servesOutsideParties: () => Promise.resolve(isOn), clock: { now: () => AT } });
  addClientParty = createAddClientParty({ parties, approveClientParty, clients, secrets: fakeSecrets() });
});

function anAddition(overrides: Partial<Parameters<typeof addClientParty>[0]> = {}): Parameters<typeof addClientParty>[0] {
  return { actor: APPROVER_ACTOR, requestId: 'r-1', name: 'agentcore', ownerShipId: OWNER_SHIP_ID, scopes: ['messages:send', 'fleet:read'], ...overrides };
}

describe('an approver adds a client party that signs in with client credentials (vendor platforms V4)', () => {
  it('commissions its mcp-client proxy ship with its owner and the scopes beyond every app ship\'s, under the request as its key', async () => {
    await addClientParty(anAddition());

    expect(fleet.state.commissioned).toEqual([{ name: 'agentcore', type: 'mcp-client', owner: OWNER_SHIP_ID, idempotencyKey: 'r-1', scopes: ['fleet:read'] }]);
  });

  it('crews the proxy ship and answers the client id and secret once', async () => {
    await expect(addClientParty(anAddition())).resolves.toEqual({
      isOk: true,
      value: { party: { name: 'agentcore', kind: 'mcpClient', clientId: 'client-secret-1', state: 'crewed', proxyShipId: PROXY_SHIP_ID }, clientId: 'client-secret-1', clientSecret: 'secret-2' },
    });
  });

  it('keeps only the hash of the client secret, for a client with no redirect URI that signs in by client credentials', async () => {
    await addClientParty(anAddition());

    expect(clients.held.get('client-secret-1')).toEqual({ clientId: 'client-secret-1', fleetId: FLEET_ID, name: 'agentcore', redirectUris: [], secretHash: 'hash(secret-2)', grant: 'clientCredentials' });
  });

  it('answers a repeated addition with the party and no secret again', async () => {
    await addClientParty(anAddition());

    await expect(addClientParty(anAddition())).resolves.toMatchObject({ isOk: true, value: { clientId: 'client-secret-1', clientSecret: null, party: { state: 'crewed' } } });
    expect(fleet.state.commissioned).toHaveLength(1);
    expect(clients.held.get('client-secret-1')?.secretHash).toBe('hash(secret-2)');
  });

  it('leaves the party awaiting crew, with no secret, when the commission\'s answer was lost', async () => {
    fleet.state.isLosingNextAnswer = true;
    await addClientParty(anAddition());

    await expect(addClientParty(anAddition())).resolves.toMatchObject({ isOk: true, value: { clientSecret: null, party: { state: 'awaitingCrew' } } });
  });

  it('refuses an actor without gateway:approve, commissioning nothing', async () => {
    await expect(addClientParty(anAddition({ actor: { ...APPROVER_ACTOR, scopes: ['fleet:read', 'fleet:manage'] } }))).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_AN_APPROVER' } });
    expect(fleet.state.commissioned).toEqual([]);
  });

  it('refuses a scope the approver does not hold, commissioning nothing', async () => {
    await expect(addClientParty(anAddition({ scopes: ['fleet:manage'] }))).resolves.toMatchObject({ isOk: false, error: { kind: 'SCOPE_NOT_HELD' } });
    expect(fleet.state.commissioned).toEqual([]);
  });

  it("refuses a scope the gateway's ship does not hold, keeping nothing", async () => {
    const approver: Actor = { ...APPROVER_ACTOR, scopes: ['gateway:approve', 'fleet:manage'] };

    await expect(addClientParty(anAddition({ actor: approver, scopes: ['fleet:manage'] }))).resolves.toMatchObject({ isOk: false, error: { kind: 'COMMISSION_REFUSED' } });
    expect([fleet.state.commissioned, [...parties.held.keys()]]).toEqual([[], []]);
  });

  it("refuses while the fleet's outside parties are off (interop I-3), commissioning nothing", async () => {
    isOn = false;

    await expect(addClientParty(anAddition())).resolves.toMatchObject({ isOk: false, error: { kind: 'OUTSIDE_PARTIES_OFF' } });
    expect(fleet.state.commissioned).toEqual([]);
  });

  it('refuses a name another party holds', async () => {
    await addClientParty(anAddition());

    await expect(addClientParty(anAddition({ requestId: 'r-2' }))).resolves.toMatchObject({ isOk: false, error: { kind: 'PARTY_EXISTS' } });
  });
});
