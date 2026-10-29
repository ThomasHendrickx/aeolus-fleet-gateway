import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, SHIP_ID, fakeGatewayFleet, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { GATEWAY_NAMESPACE } from './connect.js';
import { createDeclareGatewayScopes } from './declare-gateway-scopes.js';

// A fleet the gateway connected to before a scope joined its namespace holds
// the old list: the gateway declares its whole list again as it starts
// (decision 0046 takes a declaration again), so gateway:slack is offered there
// with no second connect.

const AT = new Date('2026-10-27T09:00:00.000Z');

let fleet: ReturnType<typeof fakeGatewayFleet>;
let store: ReturnType<typeof memoryConnectionStore>;

beforeEach(() => {
  fleet = fakeGatewayFleet();
  store = memoryConnectionStore();
});

describe("declaring the gateway's scopes again", () => {
  it('declares the whole namespace, gateway:slack included, with the kept crew token of a connected fleet', async () => {
    await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_kept', crewedAt: AT });
    fleet.state.liveTokens.add('aeolus_ct_v1_kept');

    await expect(createDeclareGatewayScopes({ door: fleet.door, store })(FLEET_ID)).resolves.toEqual({ isOk: true, value: undefined });
    expect(fleet.state.declared).toEqual([GATEWAY_NAMESPACE]);
  });

  it('declares nothing for a fleet the gateway is not connected to', async () => {
    await expect(createDeclareGatewayScopes({ door: fleet.door, store })(FLEET_ID)).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
    expect(fleet.state.declared).toEqual([]);
  });

  it('says why the fleet did not take the declaration, keeping the connection', async () => {
    await store.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_kept', crewedAt: AT });
    fleet.state.liveTokens.add('aeolus_ct_v1_kept');
    fleet.state.declareRefusal = { code: 'UNAVAILABLE', message: 'The fleet did not answer' };

    await expect(createDeclareGatewayScopes({ door: fleet.door, store })(FLEET_ID)).resolves.toEqual({
      isOk: false,
      error: { kind: 'SCOPE_REFUSED', message: "The fleet did not take the gateway's scopes gateway:approve, gateway:slack: The fleet did not answer" },
    });
    expect(store.held.size).toBe(1);
  });
});
