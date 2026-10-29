import { beforeEach, describe, expect, it } from 'vitest';

import { fakeShipReads, FLEET_ID, memoryConnectionStore, OTHER_FLEET_ID, SHIP_ID } from '../../../test/support/fleet-fakes.js';
import { memoryPartyStore } from '../../../test/support/party-fakes.js';
import { ATTIO_CLIENT, JORIS_SHIP_ID, MATHILDE_SHIP_ID, aPartyGrant, anAttioParty, fakePartySignIns, memoryPartyGrants } from '../../../test/support/party-grant-fakes.js';
import { signInServersOf } from '../parties/sign-in-servers.js';
import { err } from '../shared/result.js';
import { createEndRetiredPersonsGrants } from './end-retired-persons-grants.js';

// A person's grants go when their person ship is retired (decision 0067,
// Q6): a round of the gateway reads each person ship holding a grant, as
// the gateway's ship on its behalf, and ends every grant of a retired one.

const REVOKING_CLIENT = { ...ATTIO_CLIENT, revocationEndpoint: 'https://app.attio.com/oidc/revoke' };

let parties: ReturnType<typeof memoryPartyStore>;
let grants: ReturnType<typeof memoryPartyGrants>;
let ships: ReturnType<typeof fakeShipReads>;
let attio: ReturnType<typeof fakePartySignIns>;
let endRetiredPersonsGrants: ReturnType<typeof createEndRetiredPersonsGrants>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(anAttioParty({ credential: { kind: 'personSignIn', client: REVOKING_CLIENT } }));
  await parties.save(anAttioParty({ name: 'linear', credential: { kind: 'personSignIn', client: { ...ATTIO_CLIENT, clientId: 'client-linear' } } }));
  grants = memoryPartyGrants();
  await grants.keep(aPartyGrant());
  await grants.keep(aPartyGrant({ party: 'linear', accessToken: 'access-linear' }));
  await grants.keep(aPartyGrant({ personShipId: JORIS_SHIP_ID, accountId: 'acc-joris', outsideAccount: { subject: 'sub-2', name: null } }));
  ships = fakeShipReads();
  ships.state.ships.set(MATHILDE_SHIP_ID, { name: 'mathilde', scopes: [], status: 'retired' });
  ships.state.ships.set(JORIS_SHIP_ID, { name: 'joris', scopes: [] });
  const connections = memoryConnectionStore();
  await connections.save({ fleetId: FLEET_ID, shipId: SHIP_ID, name: 'gateway', crewToken: 'aeolus_ct_v1_gateway', crewedAt: new Date('2026-10-25T09:00:00.000Z') });
  attio = fakePartySignIns();
  endRetiredPersonsGrants = createEndRetiredPersonsGrants({ connections, door: ships.door, servers: signInServersOf(parties), grants, signIns: attio.signIns });
});

const heldBy = () => grants.held.map(({ party, personShipId }) => ({ party, personShipId }));

describe("a retired person ship's grants (Q6)", () => {
  it("ends every grant of Mathilde's retired person ship, revoked where the server offers it, leaving Joris's (scenario 29)", async () => {
    await endRetiredPersonsGrants();

    expect({ revoked: attio.state.revoked.map(({ token }) => token), held: heldBy() }).toEqual({
      revoked: ['refresh-mathilde', 'access-mathilde'],
      held: [{ party: 'attio', personShipId: JORIS_SHIP_ID }],
    });
  });

  it('ends the grants of a person ship the fleet answers it has not, as it answers a retired one read on its behalf', async () => {
    ships.state.ships.delete(MATHILDE_SHIP_ID);

    await endRetiredPersonsGrants();

    expect(heldBy()).toEqual([{ party: 'attio', personShipId: JORIS_SHIP_ID }]);
  });

  it('keeps the grants of a person ship the fleet refuses to read for another reason', async () => {
    const reading = ships.door.getShip;
    ships.door.getShip = (crewToken, ship) => (ship.shipId === MATHILDE_SHIP_ID ? Promise.resolve(err({ code: 'FORBIDDEN', message: 'outside the read reach' })) : reading(crewToken, ship));

    await endRetiredPersonsGrants();

    expect(grants.held).toHaveLength(3);
  });

  it('reads each person ship once a round, as the gateway on its behalf', async () => {
    await endRetiredPersonsGrants();

    expect(ships.state.reads).toEqual([
      { crewToken: 'aeolus_ct_v1_gateway', shipId: MATHILDE_SHIP_ID, onBehalfOf: MATHILDE_SHIP_ID },
      { crewToken: 'aeolus_ct_v1_gateway', shipId: JORIS_SHIP_ID, onBehalfOf: JORIS_SHIP_ID },
    ]);
  });

  it('keeps every grant while the fleet does not answer, to read again at the next round', async () => {
    ships.state.isAnswering = false;

    await endRetiredPersonsGrants();

    expect(grants.held).toHaveLength(3);
  });

  it('keeps the grants of a fleet the gateway is not connected to', async () => {
    await grants.keep(aPartyGrant({ fleetId: OTHER_FLEET_ID }));

    await endRetiredPersonsGrants();

    expect(grants.held.map(({ fleetId }) => fleetId)).toEqual([FLEET_ID, OTHER_FLEET_ID]);
  });
});
