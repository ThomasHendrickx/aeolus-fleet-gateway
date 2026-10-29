import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, memoryConnectionStore, SHIP_ID } from '../../../test/support/fleet-fakes.js';
import { fakeProxyShipsAsActor, memoryPartyStore, OWNER_SHIP_ID } from '../../../test/support/party-fakes.js';
import { JORIS_SHIP_ID, MATHILDE_SHIP_ID, aPartyGrant, anAttioParty, memoryPartyGrants } from '../../../test/support/party-grant-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { createCredentialOf } from '../actors/credential-of.js';
import { err } from '../shared/result.js';
import { createListGrants } from './list-grants.js';

// Every actor holding gateway:approve within manage reach of an outside MCP
// server's proxy ship sees every person's sign-in to it (decision 0067,
// Q12): the outside account, its state, when signed in and last used, never
// a token. A person without it sees only their own.

const APPROVER: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-approver', personShipId: OWNER_SHIP_ID, accountToken: 'account-token', scopes: ['gateway:approve', 'fleet:read'] };
const LOST = { at: new Date('2026-10-28T16:00:00.000Z'), why: 'invalid_grant: the refresh token is revoked' };

let parties: ReturnType<typeof memoryPartyStore>;
let connections: ReturnType<typeof memoryConnectionStore>;
let grants: ReturnType<typeof memoryPartyGrants>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(anAttioParty());
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: new Date('2026-10-25T09:00:00.000Z') });
  grants = memoryPartyGrants();
  await grants.keep(aPartyGrant({ lastUsedAt: new Date('2026-10-28T14:30:00.000Z') }));
  await grants.keep(aPartyGrant({ personShipId: JORIS_SHIP_ID, accountId: 'acc-joris', outsideAccount: { subject: 'sub-2', name: null }, lost: LOST }));
});

function listing(fleet = fakeProxyShipsAsActor()) {
  return createListGrants({ parties, connections, fleet, credentialOf: createCredentialOf({ connections }), grants });
}

/** Persons signed in to Attio: ships whose ids sort after Mathilde's and Joris's. */
async function signedInPersons(count: number): Promise<ShipId[]> {
  const persons = Array.from({ length: count }, (_, at): ShipId => `shp_01m3tbfspe96yf1rnr4anp${String(at).padStart(4, '0')}`);
  for (const [at, personShipId] of persons.entries()) {
    await grants.keep(aPartyGrant({ personShipId, accountId: `acc-${String(at)}`, outsideAccount: { subject: `sub-p${String(at)}`, name: null } }));
  }
  return persons;
}

describe("an approver sees every person's sign-in to an outside MCP server (Q12)", () => {
  it('answers each person, their outside account, state, when signed in and last used, never a token', async () => {
    await expect(listing()({ actor: APPROVER, as: {}, name: 'attio', after: null })).resolves.toEqual({
      isOk: true,
      value: {
        grants: [
          { personShipId: JORIS_SHIP_ID, state: 'lost', outsideAccount: { subject: 'sub-2', name: null }, signedInAt: new Date('2026-10-28T14:00:00.000Z'), lastUsedAt: null, lost: LOST },
          { personShipId: MATHILDE_SHIP_ID, state: 'signedIn', outsideAccount: { subject: 'sub-1', name: 'mathilde@acme.example' }, signedInAt: new Date('2026-10-28T14:00:00.000Z'), lastUsedAt: new Date('2026-10-28T14:30:00.000Z') },
        ],
        next: null,
      },
    });
  });

  it('answers 20 a page, and the next page after the last person of the one before', async () => {
    const persons = await signedInPersons(19);

    const first = await listing()({ actor: APPROVER, as: {}, name: 'attio', after: null });
    const next = first.isOk ? first.value.next : null;
    const second = await listing()({ actor: APPROVER, as: {}, name: 'attio', after: next });

    expect({ first: first.isOk && first.value.grants.length, next, second: second.isOk && second.value }).toEqual({
      first: 20,
      next: persons[17],
      second: { grants: [expect.objectContaining({ personShipId: persons[18] })], next: null },
    });
  });

  it('answers exactly 20 persons on one page, with no next page', async () => {
    await signedInPersons(18);

    await expect(listing()({ actor: APPROVER, as: {}, name: 'attio', after: null })).resolves.toMatchObject({ isOk: true, value: { grants: { length: 20 }, next: null } });
  });

  it('answers none for a server nobody signed in to', async () => {
    await grants.remove(FLEET_ID, { party: 'attio', personShipId: MATHILDE_SHIP_ID });
    await grants.remove(FLEET_ID, { party: 'attio', personShipId: JORIS_SHIP_ID });

    await expect(listing()({ actor: APPROVER, as: {}, name: 'attio', after: null })).resolves.toEqual({ isOk: true, value: { grants: [], next: null } });
  });

  it('refuses a person without gateway:approve, who sees only their own grant (scenario 26)', async () => {
    const mathilde: Actor = { ...APPROVER, accountId: 'acc-mathilde', personShipId: MATHILDE_SHIP_ID, scopes: ['fleet:read'] };

    await expect(listing()({ actor: mathilde, as: {}, name: 'attio', after: null })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_AN_APPROVER' } });
  });

  it("refuses an approver outside the proxy ship's manage reach", async () => {
    const fleet = fakeProxyShipsAsActor(err({ code: 'FORBIDDEN', message: 'attio is not within your manage reach' }));

    await expect(listing(fleet)({ actor: APPROVER, as: {}, name: 'attio', after: null })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_REACHABLE' } });
  });
});
