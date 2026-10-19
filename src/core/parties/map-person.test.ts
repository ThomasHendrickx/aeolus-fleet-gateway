import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { CHARLOTTE_SHIP_ID, fakeProxyShipFleet, memoryPartyStore } from '../../../test/support/party-fakes.js';
import { createMapPerson } from './map-person.js';

// argo maps a person to their own ship (interop I-4, Q17, Q26): the person
// signs in with the company's identity provider, and the gateway crews
// their ship for them, so their chat holds no crew token.

const AT = new Date('2026-10-19T09:00:00.000Z');
const SECRET = 'aeolus_sk_v1_charlotte';
const CHARLOTTE = { operatorFleetId: FLEET_ID, email: 'charlotte@example.com', shipId: CHARLOTTE_SHIP_ID, secret: SECRET };

let parties: ReturnType<typeof memoryPartyStore>;
let fleet: ReturnType<typeof fakeProxyShipFleet>;
let mapPerson: ReturnType<typeof createMapPerson>;

beforeEach(() => {
  parties = memoryPartyStore();
  fleet = fakeProxyShipFleet();
  fleet.state.secrets.set(CHARLOTTE_SHIP_ID, SECRET);
  fleet.state.ships.set(`aeolus_ct_v1_${CHARLOTTE_SHIP_ID}`, { shipId: CHARLOTTE_SHIP_ID, fleetId: FLEET_ID, name: 'charlotte', type: 'person' });
  mapPerson = createMapPerson({ parties, door: fleet.door, clock: { now: () => AT } });
});

describe("argo maps a person, by their email, to their own ship", () => {
  it('crews their ship with the secret argo hands over, and keeps them by their email, not yet bound to a sign-in', async () => {
    const mapped = await mapPerson(CHARLOTTE);

    expect(mapped).toEqual({ isOk: true, value: { name: 'charlotte', kind: 'person', email: 'charlotte@example.com', isSignedIn: false, ownerShipId: CHARLOTTE_SHIP_ID, state: 'crewed', proxyShipId: CHARLOTTE_SHIP_ID } });
    expect(await parties.findPersonByEmail(FLEET_ID, 'charlotte@example.com')).toMatchObject({ name: 'charlotte', crewToken: `aeolus_ct_v1_${CHARLOTTE_SHIP_ID}`, secret: null, issuer: null, subject: null, approvedAt: AT });
  });

  it('keeps the email in lower case, as a sign-in is matched to it', async () => {
    await mapPerson({ ...CHARLOTTE, email: 'Charlotte@Example.COM' });

    await expect(parties.findPersonByEmail(FLEET_ID, 'charlotte@example.com')).resolves.toBeDefined();
  });

  it('refuses a secret the fleet refuses, keeping nothing', async () => {
    await expect(mapPerson({ ...CHARLOTTE, secret: 'aeolus_sk_v1_wrong' })).resolves.toMatchObject({ isOk: false, error: { kind: 'SECRET_REFUSED' } });
    expect(parties.held.size).toBe(0);
  });

  it("refuses a ship of another fleet than argo's", async () => {
    fleet.state.ships.set(`aeolus_ct_v1_${CHARLOTTE_SHIP_ID}`, { shipId: CHARLOTTE_SHIP_ID, fleetId: OTHER_FLEET_ID, name: 'charlotte', type: 'person' });

    await expect(mapPerson(CHARLOTTE)).resolves.toMatchObject({ isOk: false, error: { kind: 'OTHER_FLEET' } });
    expect(parties.held.size).toBe(0);
  });

  it('refuses an email argo mapped already, asking the fleet nothing', async () => {
    await mapPerson(CHARLOTTE);
    fleet.state.crewed.clear();

    await expect(mapPerson({ ...CHARLOTTE, email: 'CHARLOTTE@example.com' })).resolves.toMatchObject({ isOk: false, error: { kind: 'PERSON_EXISTS' } });
  });

  it('refuses a ship that is a party already', async () => {
    await mapPerson(CHARLOTTE);
    fleet.state.crewed.clear();

    await expect(mapPerson({ ...CHARLOTTE, email: 'charlotte.other@example.com' })).resolves.toMatchObject({ isOk: false, error: { kind: 'PARTY_EXISTS' } });
  });
});
