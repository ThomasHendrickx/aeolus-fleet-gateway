import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { memoryPartyStore } from '../../../test/support/party-fakes.js';
import { ATTIO_CLIENT, JORIS_SHIP_ID, MATHILDE_SHIP_ID, aPartyGrant, anAttioParty, fakePartySignIns, memoryPartyGrants } from '../../../test/support/party-grant-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { err } from '../shared/result.js';
import { createReadOwnGrant } from './read-own-grant.js';
import { createRemoveOwnGrant } from './remove-own-grant.js';

const MATHILDE: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-mathilde', personShipId: MATHILDE_SHIP_ID, accountToken: 'account-token', scopes: ['fleet:read'] };
const REVOKING_CLIENT = { ...ATTIO_CLIENT, revocationEndpoint: 'https://app.attio.com/oidc/revoke' };

let parties: ReturnType<typeof memoryPartyStore>;
let grants: ReturnType<typeof memoryPartyGrants>;
let attio: ReturnType<typeof fakePartySignIns>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(anAttioParty());
  grants = memoryPartyGrants();
  await grants.keep(aPartyGrant());
  await grants.keep(aPartyGrant({ personShipId: JORIS_SHIP_ID, accountId: 'acc-joris', outsideAccount: { subject: 'sub-2', name: null }, accessToken: 'access-joris', refreshToken: null }));
  attio = fakePartySignIns();
});

describe('a person reads their own sign-in to an outside MCP server (Q12)', () => {
  const reading = () => createReadOwnGrant({ parties, grants });

  it('answers their grant: the outside account, when they signed in and last used it, never a token (scenario 6)', async () => {
    await expect(reading()({ actor: MATHILDE, name: 'attio' })).resolves.toEqual({
      isOk: true,
      value: { state: 'signedIn', outsideAccount: { subject: 'sub-1', name: 'mathilde@acme.example' }, signedInAt: new Date('2026-10-28T14:00:00.000Z'), lastUsedAt: null },
    });
  });

  it('answers not signed in for a person who holds no grant of the party', async () => {
    await grants.remove(FLEET_ID, { party: 'attio', personShipId: MATHILDE_SHIP_ID });

    await expect(reading()({ actor: MATHILDE, name: 'attio' })).resolves.toEqual({ isOk: true, value: { state: 'notSignedIn' } });
  });

  it('refuses an account with no person ship, and a party where nobody signs in', async () => {
    await parties.save(anAttioParty({ name: 'crm', credential: { kind: 'none' } }));

    await expect(Promise.all([reading()({ actor: { ...MATHILDE, personShipId: null }, name: 'attio' }), reading()({ actor: MATHILDE, name: 'crm' })])).resolves.toMatchObject([
      { isOk: false, error: { kind: 'NOT_A_PERSON' } },
      { isOk: false, error: { kind: 'NO_SIGN_IN' } },
    ]);
  });
});

describe('a person removes their own sign-in to an outside MCP server (Q6)', () => {
  const removing = () => createRemoveOwnGrant({ parties, grants, signIns: attio.signIns });

  it("revokes its refresh and access tokens where the server offers revocation, then drops it, leaving everyone else's (scenario 24)", async () => {
    await parties.save(anAttioParty({ credential: { kind: 'personSignIn', client: REVOKING_CLIENT } }));

    await expect(removing()({ actor: MATHILDE, name: 'attio' })).resolves.toEqual({ isOk: true, value: { isRevoked: true } });
    expect(attio.state.revoked).toEqual([
      { revocationEndpoint: 'https://app.attio.com/oidc/revoke', token: 'refresh-mathilde' },
      { revocationEndpoint: 'https://app.attio.com/oidc/revoke', token: 'access-mathilde' },
    ]);
    expect(grants.held.map((grant) => grant.personShipId)).toEqual([JORIS_SHIP_ID]);
  });

  it('drops it where the server offers no revocation, saying it was not revoked there', async () => {
    await expect(removing()({ actor: MATHILDE, name: 'attio' })).resolves.toEqual({ isOk: true, value: { isRevoked: false } });
    expect({ revoked: attio.state.revoked, held: grants.held.map((grant) => grant.personShipId) }).toEqual({ revoked: [], held: [JORIS_SHIP_ID] });
  });

  it('drops it when the revocation fails, saying it was not revoked there', async () => {
    await parties.save(anAttioParty({ credential: { kind: 'personSignIn', client: REVOKING_CLIENT } }));
    attio.state.revocation = err({ reason: 'connect ECONNREFUSED' });

    await expect(removing()({ actor: MATHILDE, name: 'attio' })).resolves.toEqual({ isOk: true, value: { isRevoked: false } });
    expect(grants.held.map((grant) => grant.personShipId)).toEqual([JORIS_SHIP_ID]);
  });

  it('says so for a person who holds no grant of the party', async () => {
    await grants.remove(FLEET_ID, { party: 'attio', personShipId: MATHILDE_SHIP_ID });

    await expect(removing()({ actor: MATHILDE, name: 'attio' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_SIGNED_IN' } });
  });

  it('refuses an account with no person ship', async () => {
    await expect(removing()({ actor: { ...MATHILDE, personShipId: null }, name: 'attio' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_PERSON' } });
    expect(grants.held).toHaveLength(2);
  });
});
