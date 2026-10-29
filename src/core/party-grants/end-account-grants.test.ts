import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { memoryPartyStore } from '../../../test/support/party-fakes.js';
import { ATTIO_CLIENT, JORIS_SHIP_ID, aPartyGrant, anAttioParty, fakePartySignIns, memoryPartyGrants } from '../../../test/support/party-grant-fakes.js';
import { signInServersOf } from '../parties/sign-in-servers.js';
import { createEndAccountGrants } from './end-account-grants.js';

// pagasae disabled an account and tells the gateway (decision 0067, Q14):
// every grant of the account in the fleet ends, so its ships call as the
// leaver no more.

const REVOKING_CLIENT = { ...ATTIO_CLIENT, revocationEndpoint: 'https://app.attio.com/oidc/revoke' };

let parties: ReturnType<typeof memoryPartyStore>;
let grants: ReturnType<typeof memoryPartyGrants>;
let attio: ReturnType<typeof fakePartySignIns>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(anAttioParty({ credential: { kind: 'personSignIn', client: REVOKING_CLIENT } }));
  await parties.save(anAttioParty({ name: 'linear', credential: { kind: 'personSignIn', client: { ...ATTIO_CLIENT, clientId: 'client-linear' } } }));
  grants = memoryPartyGrants();
  await grants.keep(aPartyGrant());
  await grants.keep(aPartyGrant({ party: 'linear', accessToken: 'access-linear', refreshToken: null }));
  await grants.keep(aPartyGrant({ fleetId: OTHER_FLEET_ID }));
  await grants.keep(aPartyGrant({ personShipId: JORIS_SHIP_ID, accountId: 'acc-joris', outsideAccount: { subject: 'sub-2', name: null } }));
  attio = fakePartySignIns();
});

describe("a disabled account's grants (Q14)", () => {
  it("ends every grant of Mathilde's account in the fleet, revoked where the server offers it, leaving Joris's and her other fleet's (scenario 30)", async () => {
    await createEndAccountGrants({ servers: signInServersOf(parties), grants, signIns: attio.signIns })({ fleetId: FLEET_ID, accountId: 'acc-mathilde' });

    expect({ revoked: attio.state.revoked.map(({ token }) => token), held: grants.held.map(({ fleetId, accountId }) => ({ fleetId, accountId })) }).toEqual({
      revoked: ['refresh-mathilde', 'access-mathilde'],
      held: [
        { fleetId: OTHER_FLEET_ID, accountId: 'acc-mathilde' },
        { fleetId: FLEET_ID, accountId: 'acc-joris' },
      ],
    });
  });

  it('ends nothing more when told again', async () => {
    const endAccountGrants = createEndAccountGrants({ servers: signInServersOf(parties), grants, signIns: attio.signIns });
    await endAccountGrants({ fleetId: FLEET_ID, accountId: 'acc-mathilde' });

    await endAccountGrants({ fleetId: FLEET_ID, accountId: 'acc-mathilde' });

    expect({ revoked: attio.state.revoked, held: grants.held }).toMatchObject({ revoked: { length: 2 }, held: { length: 2 } });
  });
});
