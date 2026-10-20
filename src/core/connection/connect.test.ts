import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, GATEWAY_SCOPES, OTHER_FLEET_ID, SHIP_ID, fakeGatewayFleet, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { createConnect } from './connect.js';

const AT = new Date('2026-10-18T11:00:00.000Z');

let fleet: ReturnType<typeof fakeGatewayFleet>;
let store: ReturnType<typeof memoryConnectionStore>;

beforeEach(() => {
  fleet = fakeGatewayFleet();
  store = memoryConnectionStore();
});

function connect(input: { secret: string; operatorFleetId?: typeof FLEET_ID }) {
  return createConnect({ door: fleet.door, store, clock: { now: () => AT } })({ operatorFleetId: input.operatorFleetId ?? FLEET_ID, shipId: SHIP_ID, secret: input.secret });
}

describe('connecting the gateway', () => {
  it('registers with the secret, keeps the crew token and answers connected as the ship', async () => {
    await expect(connect({ secret: 'aeolus_sk_v1_good' })).resolves.toEqual({
      isOk: true,
      value: { state: 'connected', ship: { shipId: SHIP_ID, name: 'gateway' }, lastShipId: SHIP_ID },
    });
    await expect(store.find(FLEET_ID)).resolves.toEqual({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_1', crewedAt: AT });
  });

  it('is refused while the gateway is connected to the fleet: connect only from not connected', async () => {
    await connect({ secret: 'aeolus_sk_v1_good' });

    await expect(connect({ secret: 'aeolus_sk_v1_good' })).resolves.toMatchObject({ isOk: false, error: { kind: 'ALREADY_CONNECTED' } });
    expect(fleet.state.registers).toBe(1);
  });

  it('is refused with a secret the fleet refuses, and keeps nothing', async () => {
    await expect(connect({ secret: 'aeolus_sk_v1_wrong' })).resolves.toMatchObject({ isOk: false, error: { kind: 'SECRET_REFUSED' } });
    expect(store.held.size).toBe(0);
  });

  it('connects a second fleet while the first stays connected: one connection per fleet', async () => {
    await connect({ secret: 'aeolus_sk_v1_good' });
    fleet.state.fleetId = OTHER_FLEET_ID;
    fleet.state.isCrewed = false;

    await expect(connect({ secret: 'aeolus_sk_v1_good', operatorFleetId: OTHER_FLEET_ID })).resolves.toMatchObject({ isOk: true, value: { state: 'connected' } });
    await expect(store.connected().then((crews) => crews.map((crew) => crew.fleetId).sort())).resolves.toEqual([FLEET_ID, OTHER_FLEET_ID].sort());
  });

  it("is refused for a ship of another fleet than the operator's, and lets the ship go again", async () => {
    fleet.state.fleetId = OTHER_FLEET_ID;

    await expect(connect({ secret: 'aeolus_sk_v1_good' })).resolves.toMatchObject({ isOk: false, error: { kind: 'OTHER_FLEET' } });
    expect([store.held.size, fleet.state.deregistered]).toEqual([0, ['aeolus_ct_v1_1']]);
  });

  it('connects a ship holding fleet:read, fleet:commission, fleet:on-behalf and scopes:declare, and no labels scope', async () => {
    fleet.state.scopes = ['messages:send', 'messages:receive', 'fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare'];

    await expect(connect({ secret: 'aeolus_sk_v1_good' })).resolves.toMatchObject({ isOk: true, value: { state: 'connected' } });
  });

  it.each(['fleet:read', 'fleet:commission', 'fleet:on-behalf', 'scopes:declare'])('is refused for a ship without %s, and lets the ship go again', async (missing) => {
    fleet.state.scopes = GATEWAY_SCOPES.filter((scope) => scope !== missing);

    await expect(connect({ secret: 'aeolus_sk_v1_good' })).resolves.toMatchObject({ isOk: false, error: { kind: 'MISSING_SCOPES' } });
    expect([store.held.size, fleet.state.deregistered]).toEqual([0, ['aeolus_ct_v1_1']]);
  });

  it("declares the gateway's approving scope, gateway:approve, so any actor the fleet grants it approves outside parties (decision 0056)", async () => {
    await connect({ secret: 'aeolus_sk_v1_good' });

    expect(fleet.state.declared).toEqual([
      { namespace: 'gateway', scopes: [{ scope: 'gateway:approve', description: 'Approve outside parties: outside MCP clients and servers, each acting in the fleet as its proxy ship' }] },
    ]);
  });

  it('is refused when the fleet does not take the gateway\'s scope, as when another ship holds its namespace, and lets the ship go again', async () => {
    fleet.state.declareRefusal = { code: 'CONFLICT', message: 'The namespace gateway is taken by another ship' };

    await expect(connect({ secret: 'aeolus_sk_v1_good' })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'SCOPE_REFUSED', message: "The fleet did not take the gateway's scope gateway:approve: The namespace gateway is taken by another ship" },
    });
    expect([store.held.size, fleet.state.deregistered]).toEqual([0, ['aeolus_ct_v1_1']]);
  });

  it('connects whatever network the fleet has: no networking plugin is asked for (interop I-3, Thomas 20 Oct)', async () => {
    await expect(connect({ secret: 'aeolus_sk_v1_good' })).resolves.toMatchObject({ isOk: true, value: { state: 'connected' } });
  });

  it('connects again after the crew token was dropped, as the same or another ship', async () => {
    await connect({ secret: 'aeolus_sk_v1_good' });
    await store.drop(FLEET_ID);
    fleet.state.isCrewed = false;
    fleet.state.secret = 'aeolus_sk_v1_new';

    await expect(connect({ secret: 'aeolus_sk_v1_new' })).resolves.toMatchObject({ isOk: true, value: { state: 'connected' } });
  });
});
