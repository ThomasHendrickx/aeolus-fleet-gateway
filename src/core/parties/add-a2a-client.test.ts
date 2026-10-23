import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { plainHasher } from '../../../test/support/memory-installation.js';
import { fakeSecrets } from '../../../test/support/oauth-fakes.js';
import { OWNER_SHIP_ID, PROXY_SHIP_ID, fakeProxyShipFleet, memoryPartyStore } from '../../../test/support/party-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { createAddA2aClient } from './add-a2a-client.js';

const AT = new Date('2026-10-23T10:00:00.000Z');

/** An account holding the approving scope and fleet:read. */
const APPROVER: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-1', personShipId: OWNER_SHIP_ID, accountToken: 'account-token', scopes: ['gateway:approve', 'fleet:read'] };

let isOn: boolean;
let fleet: ReturnType<typeof fakeProxyShipFleet>;
let parties: ReturnType<typeof memoryPartyStore>;
let add: ReturnType<typeof createAddA2aClient>;

beforeEach(async () => {
  isOn = true;
  fleet = fakeProxyShipFleet();
  parties = memoryPartyStore();
  const connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: AT });
  add = createAddA2aClient({ connections, parties, door: fleet.door, hasher: plainHasher, servesOutsideParties: () => Promise.resolve(isOn), clock: { now: () => AT }, secrets: fakeSecrets() });
});

function anAddition(overrides: Partial<Parameters<typeof add>[0]> = {}): Parameters<typeof add>[0] {
  return { actor: APPROVER, requestId: 'r-1', name: 'supplier', ownerShipId: OWNER_SHIP_ID, scopes: ['fleet:read'], ...overrides };
}

describe('an approver adds an outside A2A client (decision 0060)', () => {
  it('commissions an a2a-client proxy ship with the owner and scopes chosen, under the request as its key', async () => {
    await add(anAddition());

    expect(fleet.state.commissioned).toEqual([{ name: 'supplier', type: 'a2a-client', owner: OWNER_SHIP_ID, idempotencyKey: 'r-1', scopes: ['fleet:read'] }]);
  });

  it('answers the crewed party and its bearer, once', async () => {
    await expect(add(anAddition())).resolves.toEqual({
      isOk: true,
      value: { party: { name: 'supplier', kind: 'a2aClient', state: 'crewed', proxyShipId: PROXY_SHIP_ID }, bearer: 'secret-1' },
    });
  });

  it("keeps only the bearer's hash, beside the proxy ship's crew token", async () => {
    await add(anAddition());

    await expect(parties.find(FLEET_ID, 'supplier')).resolves.toMatchObject({ kind: 'a2aClient', bearerHash: 'hash(secret-1)', crewToken: 'aeolus_ct_v1_proxy' });
  });

  it('answers the same request again with a new bearer in place of the first, commissioning nothing again', async () => {
    await add(anAddition());

    await expect(add(anAddition())).resolves.toMatchObject({ isOk: true, value: { bearer: 'secret-2' } });
    expect(fleet.state.commissioned).toHaveLength(1);
    await expect(parties.find(FLEET_ID, 'supplier')).resolves.toMatchObject({ bearerHash: 'hash(secret-2)' });
  });

  it('refuses an actor not holding gateway:approve, commissioning nothing', async () => {
    await expect(add(anAddition({ actor: { ...APPROVER, scopes: ['fleet:read'] } }))).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_AN_APPROVER' } });
    expect(fleet.state.commissioned).toHaveLength(0);
  });

  it('refuses a scope the approver does not hold', async () => {
    await expect(add(anAddition({ scopes: ['fleet:manage'] }))).resolves.toMatchObject({ isOk: false, error: { kind: 'SCOPE_NOT_HELD' } });
    expect(fleet.state.commissioned).toHaveLength(0);
  });

  it('grants the scopes every app ship gets without the approver holding them', async () => {
    await add(anAddition({ scopes: ['messages:send', 'fleet:read'] }));

    expect(fleet.state.commissioned[0]?.scopes).toEqual(['fleet:read']);
  });

  it("adds nothing while the fleet's outside parties are off", async () => {
    isOn = false;

    await expect(add(anAddition())).resolves.toMatchObject({ isOk: false, error: { kind: 'OUTSIDE_PARTIES_OFF' } });
    expect(parties.held.size).toBe(0);
  });

  it('refuses a name another party holds', async () => {
    await add(anAddition());

    await expect(add(anAddition({ requestId: 'r-2' }))).resolves.toMatchObject({ isOk: false, error: { kind: 'PARTY_EXISTS' } });
  });

  it('writes no verified fact: the gateway checked nothing about an A2A client', async () => {
    await add(anAddition());

    expect(fleet.state.verified.size).toBe(0);
  });
});
