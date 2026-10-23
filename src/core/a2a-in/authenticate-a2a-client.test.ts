import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeSecrets } from '../../../test/support/oauth-fakes.js';
import { PROXY_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import type { A2aClientParty } from '../parties/party.js';
import { createAuthenticateA2aClient } from './authenticate-a2a-client.js';

const AT = new Date('2026-10-23T10:00:00.000Z');

function anA2aClient(overrides: Partial<A2aClientParty> = {}): A2aClientParty {
  return {
    fleetId: FLEET_ID,
    name: 'supplier',
    kind: 'a2aClient',
    bearerHash: 'hash(bearer-1)',
    state: 'crewed',
    proxyShipId: PROXY_SHIP_ID,
    secret: null,
    crewToken: 'aeolus_ct_v1_proxy',
    requestId: 'r-1',
    requestHash: 'h',
    approvedAt: AT,
    ...overrides,
  };
}

let isOn: boolean;
let parties: ReturnType<typeof memoryPartyStore>;
let authenticate: ReturnType<typeof createAuthenticateA2aClient>;

beforeEach(async () => {
  isOn = true;
  parties = memoryPartyStore();
  await parties.save(anA2aClient());
  authenticate = createAuthenticateA2aClient({ parties, secrets: fakeSecrets(), servesOutsideParties: () => Promise.resolve(isOn) });
});

describe('the bearer names the A2A client calling (decision 0060)', () => {
  it('answers the party and its fleet for the bearer it was shown', async () => {
    await expect(authenticate('bearer-1')).resolves.toEqual({ isOk: true, value: { fleetId: FLEET_ID, party: 'supplier' } });
  });

  it('refuses a bearer no party was shown', async () => {
    await expect(authenticate('bearer-2')).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_AN_ACTOR' } });
  });

  it("refuses every call while the fleet's outside parties are off", async () => {
    isOn = false;

    await expect(authenticate('bearer-1')).resolves.toMatchObject({ isOk: false, error: { kind: 'OUTSIDE_PARTIES_OFF' } });
  });
});
