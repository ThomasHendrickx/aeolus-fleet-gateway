import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, memoryConnectionStore, SHIP_ID } from '../../../test/support/fleet-fakes.js';
import { fakeProxyShipsAsActor, memoryPartyStore, OWNER_SHIP_ID, PROXY_SHIP_ID } from '../../../test/support/party-fakes.js';
import { ATTIO_CLIENT, JORIS_SHIP_ID, MATHILDE_SHIP_ID, aPartyGrant, anAttioParty, fakePartySignIns, memoryPartyGrants } from '../../../test/support/party-grant-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { createCredentialOf } from '../actors/credential-of.js';
import { err } from '../shared/result.js';
import { createRemoveGrant } from './remove-grant.js';

// An actor holding gateway:approve within manage reach of the proxy ship
// removes any person's sign-in to an outside MCP server where each person
// signs in (decision 0067, Q6): it ends as every grant ends.

const APPROVER: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-approver', personShipId: OWNER_SHIP_ID, accountToken: 'account-token', scopes: ['gateway:approve', 'fleet:read'] };
const REVOKING_CLIENT = { ...ATTIO_CLIENT, revocationEndpoint: 'https://app.attio.com/oidc/revoke' };

let parties: ReturnType<typeof memoryPartyStore>;
let connections: ReturnType<typeof memoryConnectionStore>;
let grants: ReturnType<typeof memoryPartyGrants>;
let attio: ReturnType<typeof fakePartySignIns>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(anAttioParty({ credential: { kind: 'personSignIn', client: REVOKING_CLIENT } }));
  connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: new Date('2026-10-25T09:00:00.000Z') });
  grants = memoryPartyGrants();
  await grants.keep(aPartyGrant());
  await grants.keep(aPartyGrant({ personShipId: JORIS_SHIP_ID, accountId: 'acc-joris', outsideAccount: { subject: 'sub-2', name: null }, accessToken: 'access-joris', refreshToken: 'refresh-joris' }));
  attio = fakePartySignIns();
});

function removing(fleet = fakeProxyShipsAsActor()) {
  return createRemoveGrant({ parties, connections, fleet, credentialOf: createCredentialOf({ connections }), grants, signIns: attio.signIns });
}

describe("an approver removes any person's sign-in to an outside MCP server (Q6)", () => {
  it("revokes Joris's tokens where the server offers revocation and drops his grant, leaving Mathilde's (scenario 25)", async () => {
    await expect(removing()({ actor: APPROVER, as: {}, name: 'attio', personShipId: JORIS_SHIP_ID })).resolves.toEqual({ isOk: true, value: { isRevoked: true } });
    expect(attio.state.revoked.map(({ token }) => token)).toEqual(['refresh-joris', 'access-joris']);
    expect(grants.held.map((grant) => grant.personShipId)).toEqual([MATHILDE_SHIP_ID]);
  });

  it("refuses an approver outside the proxy ship's manage reach, dropping nothing (scenario 25)", async () => {
    const fleet = fakeProxyShipsAsActor(err({ code: 'FORBIDDEN', message: 'attio is not within your manage reach' }));

    await expect(removing(fleet)({ actor: APPROVER, as: {}, name: 'attio', personShipId: JORIS_SHIP_ID })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_REACHABLE' } });
    expect({ revoked: attio.state.revoked, held: grants.held }).toMatchObject({ revoked: [], held: { length: 2 } });
  });

  it('refuses an actor without gateway:approve, asking the fleet nothing', async () => {
    const fleet = fakeProxyShipsAsActor();

    await expect(removing(fleet)({ actor: { ...APPROVER, scopes: ['fleet:read'] }, as: {}, name: 'attio', personShipId: JORIS_SHIP_ID })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_AN_APPROVER' } });
    expect({ checked: fleet.checked, held: grants.held }).toMatchObject({ checked: [], held: { length: 2 } });
  });

  it('says so for a person who holds no grant of the party', async () => {
    await expect(removing()({ actor: APPROVER, as: {}, name: 'attio', personShipId: OWNER_SHIP_ID })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_SIGNED_IN' } });
  });

  it('refuses a server the gateway calls with its own credential', async () => {
    await parties.save(anAttioParty({ name: 'crm', credential: { kind: 'none' }, proxyShipId: PROXY_SHIP_ID }));

    await expect(removing()({ actor: APPROVER, as: {}, name: 'crm', personShipId: JORIS_SHIP_ID })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SIGN_IN' } });
  });
});
