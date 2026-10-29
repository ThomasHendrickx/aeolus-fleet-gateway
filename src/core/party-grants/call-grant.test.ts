import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { fakeShipReads, FLEET_ID, memoryConnectionStore, SHIP_ID } from '../../../test/support/fleet-fakes.js';
import { aPartyGrant, JORIS_SHIP_ID, MATHILDE_SHIP_ID, memoryPartyGrants } from '../../../test/support/party-grant-fakes.js';
import { createCallGrantOf } from './call-grant.js';

const LEAD_SCOUT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9ld5';
const ARGO: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9arg';
const MATHILDE = { shipId: MATHILDE_SHIP_ID, name: 'mathilde' };
const JORIS = { shipId: JORIS_SHIP_ID, name: 'joris' };

let ships: ReturnType<typeof fakeShipReads>;
let grants: ReturnType<typeof memoryPartyGrants>;
let callGrantOf: ReturnType<typeof createCallGrantOf>;

beforeEach(async () => {
  ships = fakeShipReads();
  grants = memoryPartyGrants();
  const connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: new Date('2026-10-25T09:00:00.000Z') });
  callGrantOf = createCallGrantOf({ connections, door: ships.door, grants });
});

const ofLeadScout = () => callGrantOf({ fleetId: FLEET_ID, party: 'attio', senderShipId: LEAD_SCOUT });

describe('the grant a call goes out under: its asking ship\'s owner\'s (decision 0067, Q1, Q11)', () => {
  it('is the grant of the person who owns the asking ship', async () => {
    ships.state.ships.set(LEAD_SCOUT, { name: 'lead-scout', scopes: [], owner: MATHILDE });
    await grants.keep(aPartyGrant());

    await expect(ofLeadScout()).resolves.toEqual({ kind: 'grant', grant: aPartyGrant(), person: MATHILDE });
  });

  it('is a person ship\'s own grant: a person ship owns itself', async () => {
    ships.state.ships.set(MATHILDE_SHIP_ID, { name: 'mathilde', scopes: [], owner: MATHILDE });
    await grants.keep(aPartyGrant());

    await expect(callGrantOf({ fleetId: FLEET_ID, party: 'attio', senderShipId: MATHILDE_SHIP_ID })).resolves.toEqual({ kind: 'grant', grant: aPartyGrant(), person: MATHILDE });
  });

  it('names the owner who never signed in to the party (Q5)', async () => {
    ships.state.ships.set(LEAD_SCOUT, { name: 'lead-scout', scopes: [], owner: JORIS });
    await grants.keep(aPartyGrant());

    await expect(ofLeadScout()).resolves.toEqual({ kind: 'notSignedIn', person: JORIS });
  });

  it('names the owner whose grant was lost: it serves no call (Q5, scenario 19)', async () => {
    ships.state.ships.set(LEAD_SCOUT, { name: 'lead-scout', scopes: [], owner: MATHILDE });
    await grants.keep(aPartyGrant({ lost: { at: new Date('2026-10-28T16:00:00.000Z'), why: 'invalid_grant: the refresh token is revoked' } }));

    await expect(ofLeadScout()).resolves.toEqual({ kind: 'notSignedIn', person: MATHILDE });
  });

  it('reads the owner at each call, so a new owner\'s grant serves the next one (Q11, scenario 27)', async () => {
    await grants.keep(aPartyGrant());
    ships.state.ships.set(LEAD_SCOUT, { name: 'lead-scout', scopes: [], owner: MATHILDE });
    await ofLeadScout();

    ships.state.ships.set(LEAD_SCOUT, { name: 'lead-scout', scopes: [], owner: JORIS });

    await expect(ofLeadScout()).resolves.toEqual({ kind: 'notSignedIn', person: JORIS });
  });

  it('finds no person for a ship argo owns (Q10)', async () => {
    ships.state.ships.set(LEAD_SCOUT, { name: 'lead-scout', scopes: [], owner: { shipId: ARGO, name: 'argo' } });

    await expect(ofLeadScout()).resolves.toEqual({ kind: 'noPerson', shipName: 'lead-scout' });
  });

  it('finds no person for a ship with no owner: argo itself', async () => {
    ships.state.ships.set(ARGO, { name: 'argo', scopes: [] });

    await expect(callGrantOf({ fleetId: FLEET_ID, party: 'attio', senderShipId: ARGO })).resolves.toEqual({ kind: 'noPerson', shipName: 'argo' });
  });

  it('reads the owner as the gateway\'s ship, on the asking ship\'s behalf, as the scope check does', async () => {
    ships.state.ships.set(LEAD_SCOUT, { name: 'lead-scout', scopes: [], owner: MATHILDE });

    await ofLeadScout();

    expect(ships.state.reads).toEqual([{ crewToken: 'aeolus_ct_v1_gateway', shipId: LEAD_SCOUT, onBehalfOf: LEAD_SCOUT }]);
  });

  it('is unread while core does not answer, so the call is never made without its person\'s grant (scenario 16)', async () => {
    ships.state.ships.set(LEAD_SCOUT, { name: 'lead-scout', scopes: [], owner: MATHILDE });
    await grants.keep(aPartyGrant());
    ships.state.isAnswering = false;

    await expect(ofLeadScout()).resolves.toEqual({ kind: 'unread' });
  });
});
