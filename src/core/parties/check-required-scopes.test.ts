import { beforeEach, describe, expect, it } from 'vitest';

import { fakeShipReads, FLEET_ID, memoryConnectionStore, SHIP_ID } from '../../../test/support/fleet-fakes.js';
import { CALLER_SHIP_ID } from '../../../test/support/mcp-out-fakes.js';
import { createCheckRequiredScopes } from './check-required-scopes.js';

const GATEWAY_CREW = 'aeolus_ct_v1_gateway';

let ships: ReturnType<typeof fakeShipReads>;
let connections: ReturnType<typeof memoryConnectionStore>;
let check: ReturnType<typeof createCheckRequiredScopes>;

beforeEach(async () => {
  ships = fakeShipReads();
  ships.state.ships.set(CALLER_SHIP_ID, { name: 'lead-scout', scopes: ['messages:send', 'crm:read-leads'] });
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: GATEWAY_CREW, crewedAt: new Date('2026-10-25T09:00:00.000Z') });
  check = createCheckRequiredScopes({ connections, door: ships.door });
});

const call = (needed: string[]) => ({ fleetId: FLEET_ID, senderShipId: CALLER_SHIP_ID, needing: 'update_lead', needed });

describe('the gateway checks the calling ship holds every scope a call needs, read from core on each call (gateway scopes 4.2)', () => {
  it('lets a call go on when the ship holds every needed scope', async () => {
    await expect(check(call(['crm:read-leads']))).resolves.toEqual({ kind: 'holds' });
  });

  it('refuses a ship that lacks a needed scope, naming the scope and the ship', async () => {
    await expect(check(call(['crm:read-leads', 'crm:write-leads']))).resolves.toEqual({ kind: 'lacks', message: 'update_lead needs crm:write-leads, which lead-scout does not hold' });
  });

  it('reads the ship as the gateway, on the ship\'s own behalf, so its read reach holds it', async () => {
    await check(call(['crm:read-leads']));

    expect(ships.state.reads).toEqual([{ crewToken: GATEWAY_CREW, shipId: CALLER_SHIP_ID, onBehalfOf: CALLER_SHIP_ID }]);
  });

  it('reads the scopes anew on each call, so a scope revoked holds at the next one', async () => {
    await check(call(['crm:read-leads']));
    ships.state.ships.set(CALLER_SHIP_ID, { name: 'lead-scout', scopes: ['messages:send'] });

    await expect(check(call(['crm:read-leads']))).resolves.toEqual({ kind: 'lacks', message: 'update_lead needs crm:read-leads, which lead-scout does not hold' });
  });

  it('reads nothing when a call needs nothing beyond reaching the party', async () => {
    await expect(check(call([]))).resolves.toEqual({ kind: 'holds' });

    expect(ships.state.reads).toEqual([]);
  });

  it('leaves the call unchecked when core does not answer, never letting it through', async () => {
    ships.state.isAnswering = false;

    await expect(check(call(['crm:read-leads']))).resolves.toEqual({ kind: 'unread' });
  });

  it('leaves the call unchecked while the gateway is not connected to the fleet', async () => {
    await connections.drop(FLEET_ID);

    await expect(check(call(['crm:read-leads']))).resolves.toEqual({ kind: 'unread' });
  });
});
