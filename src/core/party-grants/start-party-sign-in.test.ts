import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeSecrets } from '../../../test/support/oauth-fakes.js';
import { memoryPartyStore } from '../../../test/support/party-fakes.js';
import { MATHILDE_SHIP_ID, anAttioParty, fakePartySignIns, plainPartySignInSeals } from '../../../test/support/party-grant-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import { createStartPartySignIn } from './start-party-sign-in.js';

const AT = new Date('2026-10-28T14:00:00.000Z');
const REDIRECT_URI = 'https://gateway.example.com/outside-parties/sign-in/done';

const MATHILDE: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-mathilde', personShipId: MATHILDE_SHIP_ID, accountToken: 'account-token', scopes: ['fleet:read'] };

let parties: ReturnType<typeof memoryPartyStore>;
let starting: ReturnType<typeof createStartPartySignIn>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(anAttioParty());
  starting = createStartPartySignIn({ parties, seals: plainPartySignInSeals(), signIns: fakePartySignIns().signIns, secrets: fakeSecrets(), clock: { now: () => AT }, redirectUri: REDIRECT_URI });
});

describe('a person starts signing in to an outside MCP server for themselves (decision 0067)', () => {
  it("sends them to the party's authorization server with PKCE S256, the state, the client's scope and resource", async () => {
    const started = await starting({ actor: MATHILDE, name: 'attio' });

    expect(started.isOk).toBe(true);
    const url = new URL(started.isOk ? started.value.url : '');
    expect({ at: `${url.origin}${url.pathname}`, ...Object.fromEntries(url.searchParams) }).toEqual({
      at: 'https://app.attio.com/oidc/authorize',
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: REDIRECT_URI,
      scope: 'mcp offline_access openid',
      state: JSON.stringify({ fleetId: FLEET_ID, party: 'attio', accountId: 'acc-mathilde', personShipId: MATHILDE_SHIP_ID, verifier: 'secret-1', expiresAt: '2026-10-28T14:10:00.000Z' }),
      code_challenge: 'S256(secret-1)',
      code_challenge_method: 'S256',
      resource: 'https://mcp.attio.com/mcp',
    });
  });

  it('refuses an account with no person ship in the fleet', async () => {
    await expect(starting({ actor: { ...MATHILDE, personShipId: null }, name: 'attio' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_PERSON' } });
  });

  it('refuses a ship, which is no person', async () => {
    const ship: Actor = { fleetId: FLEET_ID, kind: 'ship', shipId: MATHILDE_SHIP_ID, scopes: ['fleet:read'] };

    await expect(starting({ actor: ship, name: 'attio' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_PERSON' } });
  });

  it('refuses a party where nobody signs in for themselves', async () => {
    await parties.save(anAttioParty({ name: 'crm', credential: { kind: 'bearer', token: 'crm-token' } }));

    await expect(starting({ actor: MATHILDE, name: 'crm' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SIGN_IN' } });
  });

  it('refuses a party the fleet does not have', async () => {
    await expect(starting({ actor: MATHILDE, name: 'hubspot' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_PARTY' } });
  });
});
