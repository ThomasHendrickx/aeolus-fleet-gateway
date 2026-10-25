import { beforeEach, describe, expect, it } from 'vitest';

import { fakeListedScopes, FLEET_ID, memoryConnectionStore, SHIP_ID } from '../../../test/support/fleet-fakes.js';
import { OWNER_SHIP_ID } from '../../../test/support/party-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { createReadListedScopes } from './read-listed-scopes.js';

const APPROVER: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-1', personShipId: OWNER_SHIP_ID, accountToken: 'account-token', scopes: ['gateway:approve', 'fleet:read'] };
const GATEWAY_CREW = 'aeolus_ct_v1_gateway';

let listed: ReturnType<typeof fakeListedScopes>;
let connections: ReturnType<typeof memoryConnectionStore>;
let readListedScopes: ReturnType<typeof createReadListedScopes>;

beforeEach(async () => {
  listed = fakeListedScopes(['crm:read-leads', 'crm:write-leads']);
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: GATEWAY_CREW, crewedAt: new Date('2026-10-25T09:00:00.000Z') });
  readListedScopes = createReadListedScopes({ connections, door: listed.door });
});

describe('the scopes an approver may require, as the fleet lists them (gateway scopes 4.3)', () => {
  it('answers every listed scope with its description, read as the gateway\'s ship', async () => {
    await expect(readListedScopes({ actor: APPROVER })).resolves.toEqual({
      isOk: true,
      value: [
        { scope: 'crm:read-leads', description: 'The fleet\'s crm:read-leads' },
        { scope: 'crm:write-leads', description: 'The fleet\'s crm:write-leads' },
      ],
    });
    expect(listed.state.readers).toEqual([GATEWAY_CREW]);
  });

  it('refuses an actor without gateway:approve, reading nothing', async () => {
    await expect(readListedScopes({ actor: { ...APPROVER, scopes: ['fleet:read'] } })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_AN_APPROVER' } });
    expect(listed.state.readers).toEqual([]);
  });

  it('says the fleet did not answer, and why', async () => {
    listed.state.isAnswering = false;

    await expect(readListedScopes({ actor: APPROVER })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE', message: 'The fleet did not say which scopes it lists: The fleet did not answer' } });
  });

  it('says the gateway is not connected to the fleet', async () => {
    await expect(createReadListedScopes({ connections: memoryConnectionStore(), door: listed.door })({ actor: APPROVER })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_CONNECTED' } });
  });
});
