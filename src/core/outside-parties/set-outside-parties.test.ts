import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeFleetNetwork, memoryOutsidePartySwitches } from '../../../test/support/outside-party-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { createReadOutsideParties, createSetOutsideParties } from './set-outside-parties.js';

// Outside parties are a switch per fleet, off by default (interop I-3,
// Thomas 20 Oct): no policy, but a warning. Turning them on while the fleet
// applies no network rules, so every ship reaches every ship, needs the
// warning confirmed; an actor holding fleet:network decides.

const AT = new Date('2026-10-20T12:00:00.000Z');
const NETWORKER: Actor = { fleetId: FLEET_ID, kind: 'ship', shipId: 'shp_01m3tbfspe96yf1rnr4ank9nwk', scopes: ['fleet:read', 'fleet:network'] };
const READER: Actor = { fleetId: FLEET_ID, kind: 'ship', shipId: 'shp_01m3tbfspe96yf1rnr4ank9nwk', scopes: ['fleet:read', 'fleet:manage'] };
const AS = { crewToken: 'aeolus_ct_v1_networker' };

let switches: ReturnType<typeof memoryOutsidePartySwitches>;

beforeEach(() => {
  switches = memoryOutsidePartySwitches();
});

function setOutsideParties(network: ReturnType<typeof fakeFleetNetwork>) {
  return createSetOutsideParties({ switches, network, clock: { now: () => AT } });
}

describe('outside parties of a fleet', () => {
  it('are off by default', async () => {
    await expect(createReadOutsideParties({ switches })(READER)).resolves.toEqual({ isOn: false });
  });

  it('turn on at once while the fleet applies network rules, read as the actor', async () => {
    const network = fakeFleetNetwork({ isOpen: false });

    await expect(setOutsideParties(network)({ actor: NETWORKER, as: AS, isOn: true, isOpenNetworkConfirmed: false })).resolves.toEqual({ isOk: true, value: { isOn: true } });
    expect({ readers: network.readers, held: switches.held.get(FLEET_ID) }).toEqual({ readers: [AS], held: { isOn: true, at: AT } });
  });

  it('warn, staying off, while the fleet applies no network rules', async () => {
    const turned = await setOutsideParties(fakeFleetNetwork({ isOpen: true }))({ actor: NETWORKER, as: AS, isOn: true, isOpenNetworkConfirmed: false });

    expect(turned).toEqual({
      isOk: false,
      error: { kind: 'OPEN_NETWORK', message: 'This fleet applies no network rules, so every outside party would reach every ship. Confirm to turn outside parties on anyway.' },
    });
    expect(switches.held.size).toBe(0);
  });

  it('turn on in an open network once the warning is confirmed', async () => {
    await expect(setOutsideParties(fakeFleetNetwork({ isOpen: true }))({ actor: NETWORKER, as: AS, isOn: true, isOpenNetworkConfirmed: true })).resolves.toEqual({ isOk: true, value: { isOn: true } });
  });

  it('turn off with no warning, reading no rules', async () => {
    const network = fakeFleetNetwork({ isOpen: true });
    await switches.set(FLEET_ID, { isOn: true, at: AT });

    await expect(setOutsideParties(network)({ actor: NETWORKER, as: AS, isOn: false, isOpenNetworkConfirmed: false })).resolves.toEqual({ isOk: true, value: { isOn: false } });
    expect({ readers: network.readers, isOn: await switches.isOn(FLEET_ID) }).toEqual({ readers: [], isOn: false });
  });

  it('refuse an actor without fleet:network, changing nothing', async () => {
    await expect(setOutsideParties(fakeFleetNetwork({ isOpen: false }))({ actor: READER, as: AS, isOn: true, isOpenNetworkConfirmed: true })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'NOT_A_NETWORKER' },
    });
    expect(switches.held.size).toBe(0);
  });

  it('stay off when the fleet does not say its network', async () => {
    await expect(setOutsideParties(fakeFleetNetwork({ isOpen: false, isAnswering: false }))({ actor: NETWORKER, as: AS, isOn: true, isOpenNetworkConfirmed: false })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'FLEET_UNAVAILABLE' },
    });
    expect(switches.held.size).toBe(0);
  });
});
