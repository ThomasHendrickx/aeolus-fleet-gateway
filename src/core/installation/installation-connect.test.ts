import { idSchema } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID, SHIP_ID, fakeGatewayFleet, memoryConnectionStore } from '../../../test/support/fleet-fakes.js';
import { memoryInstallationRequests, plainHasher } from '../../../test/support/memory-installation.js';
import { createConnect, type ConnectRefusal } from '../connection/connect.js';
import { err } from '../shared/result.js';
import { createInstallationConnect } from './installation-connect.js';

const AT = new Date('2026-11-17T12:00:00.000Z');
const input = { requestId: 'connect-1', fleetId: FLEET_ID, shipId: SHIP_ID, secret: 'aeolus_sk_v1_good' };
const answer = { isOk: true, value: { isEnabled: true, isConnected: true } };
let fleet: ReturnType<typeof fakeGatewayFleet>;
let store: ReturnType<typeof memoryConnectionStore>;
let requests: ReturnType<typeof memoryInstallationRequests>;
let connect: ReturnType<typeof createInstallationConnect>;

beforeEach(() => {
  fleet = fakeGatewayFleet();
  store = memoryConnectionStore();
  requests = memoryInstallationRequests();
  connect = createInstallationConnect({ requests, hasher: plainHasher, clock: { now: () => AT }, isServed: () => Promise.resolve(true), connect: createConnect({ door: fleet.door, store, clock: { now: () => AT } }) });
});

describe('the installation connects a fleet', () => {
  it('keeps the crew token and records a successful hand-over without its secret', async () => {
    await expect(connect(input)).resolves.toEqual(answer);
    expect(store.held.get(FLEET_ID)?.crewToken).toBe('aeolus_ct_v1_1');
    expect(requests.held).toEqual([{ requestId: 'connect-1', kind: 'connect', requestHash: `hash(connect ${FLEET_ID} ${SHIP_ID})`, fleetId: FLEET_ID, isEnabled: null, at: AT }]);
    expect(JSON.stringify(requests.held)).not.toContain(input.secret);
  });

  it('refuses an unserved fleet before even looking up a replay', async () => {
    await connect(input);
    const off = createInstallationConnect({ requests, hasher: plainHasher, clock: { now: () => AT }, isServed: () => Promise.resolve(false), connect: () => Promise.resolve(err({ kind: 'SECRET_REFUSED', message: 'must not connect' })) });
    await expect(off(input)).resolves.toMatchObject({ isOk: false, error: { kind: 'OFF', message: 'The gateway is off for this fleet' } });
    expect(fleet.state.registers).toBe(1);
    expect(requests.held).toHaveLength(1);
  });

  it('answers a replay without asking the fleet, even with a different secret', async () => {
    await connect(input);
    fleet.state.isAnswering = false;
    await expect(connect({ ...input, secret: 'another-secret' })).resolves.toEqual(answer);
    expect(fleet.state.registers).toBe(1);
    expect(requests.held).toHaveLength(1);
  });

  it('refuses a request id used for another fleet or ship', async () => {
    await connect(input);
    for (const changed of [{ fleetId: OTHER_FLEET_ID }, { shipId: idSchema('ship').parse('shp_01m3tbfspe96yf1rnr4ank9h1b') }]) {
      await expect(connect({ ...input, ...changed })).resolves.toMatchObject({ isOk: false, error: { kind: 'REQUEST_ID_USED' } });
    }
    expect(fleet.state.registers).toBe(1);
  });

  it('records no refusal and connects on a later try with the same request id', async () => {
    await expect(connect({ ...input, secret: 'wrong' })).resolves.toMatchObject({ isOk: false, error: { kind: 'SECRET_REFUSED' } });
    expect(requests.held).toEqual([]);
    expect(store.held.size).toBe(0);
    await expect(connect(input)).resolves.toEqual(answer);
  });

  const refusals: ConnectRefusal['kind'][] = ['ALREADY_CONNECTED', 'SECRET_REFUSED', 'OTHER_FLEET', 'MISSING_SCOPES', 'SCOPE_REFUSED', 'FLEET_UNAVAILABLE'];
  it.each(refusals)('passes through %s unchanged and records nothing', async (kind) => {
    const refusal = err({ kind, message: 'the original refusal' });
    const refused = createInstallationConnect({ requests, hasher: plainHasher, clock: { now: () => AT }, isServed: () => Promise.resolve(true), connect: () => Promise.resolve(refusal) });
    await expect(refused(input)).resolves.toEqual(refusal);
    expect(requests.held).toEqual([]);
  });
});
