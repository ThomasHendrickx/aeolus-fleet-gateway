import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { ATTIO_CLIENT, JORIS_SHIP_ID, aPartyGrant, fakePartySignIns, memoryPartyGrants } from '../../../test/support/party-grant-fakes.js';
import { err } from '../shared/result.js';
import { createEndPartyGrants } from './end-party-grants.js';

// A party where each person signs in is retired (decision 0067, scenario
// 31): every grant of it ends, and its client is deleted where the
// authorization server offers it (RFC 7592).

const REVOKING_CLIENT = { ...ATTIO_CLIENT, revocationEndpoint: 'https://app.attio.com/oidc/revoke' };
const MANAGED_CLIENT = { ...ATTIO_CLIENT, registrationClientUri: 'https://app.attio.com/oauth/register/client-1', registrationAccessToken: 'registration-token-1' };

let grants: ReturnType<typeof memoryPartyGrants>;
let attio: ReturnType<typeof fakePartySignIns>;
let endPartyGrants: ReturnType<typeof createEndPartyGrants>;

beforeEach(async () => {
  grants = memoryPartyGrants();
  await grants.keep(aPartyGrant());
  await grants.keep(aPartyGrant({ personShipId: JORIS_SHIP_ID, accountId: 'acc-joris', outsideAccount: { subject: 'sub-2', name: null }, accessToken: 'access-joris', refreshToken: 'refresh-joris' }));
  await grants.keep(aPartyGrant({ party: 'linear' }));
  attio = fakePartySignIns();
  endPartyGrants = createEndPartyGrants({ grants, signIns: attio.signIns });
});

const heldParties = () => grants.held.map(({ party }) => party);

describe("a retired party's grants and client (scenario 31)", () => {
  it("ends every person's grant of the party, revoked where the server offers it, leaving another party's", async () => {
    await endPartyGrants({ fleetId: FLEET_ID, name: 'attio', client: REVOKING_CLIENT });

    expect({ revoked: attio.state.revoked.map(({ token }) => token), held: heldParties() }).toEqual({
      revoked: ['refresh-joris', 'access-joris', 'refresh-mathilde', 'access-mathilde'],
      held: ['linear'],
    });
  });

  it('ends grants past the first page', async () => {
    for (let at = 0; at < 30; at += 1) {
      const personShipId: ShipId = `shp_01m3tbfspe96yf1rnr4anp${String(at).padStart(4, '0')}`;
      await grants.keep(aPartyGrant({ personShipId, accountId: `acc-${String(at)}`, outsideAccount: { subject: `sub-p${String(at)}`, name: null } }));
    }

    await endPartyGrants({ fleetId: FLEET_ID, name: 'attio', client: ATTIO_CLIENT });

    expect(heldParties()).toEqual(['linear']);
  });

  it('drops the grants when the revocation fails', async () => {
    attio.state.revocation = err({ reason: 'connect ECONNREFUSED' });

    await endPartyGrants({ fleetId: FLEET_ID, name: 'attio', client: REVOKING_CLIENT });

    expect(heldParties()).toEqual(['linear']);
  });

  it('deletes the client where the server answered where and with what at its registration', async () => {
    await endPartyGrants({ fleetId: FLEET_ID, name: 'attio', client: MANAGED_CLIENT });

    expect(attio.state.deletedClients).toEqual([{ registrationClientUri: 'https://app.attio.com/oauth/register/client-1', registrationAccessToken: 'registration-token-1' }]);
  });

  it('deletes no client where the server offers no client management', async () => {
    await endPartyGrants({ fleetId: FLEET_ID, name: 'attio', client: ATTIO_CLIENT });

    expect(attio.state.deletedClients).toEqual([]);
  });
});
