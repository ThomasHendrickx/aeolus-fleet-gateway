import { signInServersOf } from '../parties/sign-in-servers.js';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeMcpServers, fakeStatementDoor, memoryToolMarks } from '../../../test/support/mcp-out-fakes.js';
import { memoryPartyStore, memoryScopeRequirements } from '../../../test/support/party-fakes.js';
import { ATTIO_CLIENT, JORIS_SHIP_ID, MATHILDE_ID_TOKEN, MATHILDE_SHIP_ID, MATHILDE_TOKENS, aPartyGrant, anAttioParty, fakePartySignIns, memoryPartyGrants, memorySignInNotices, plainPartySignInSeals } from '../../../test/support/party-grant-fakes.js';
import type { SharedAccountToken } from '../account-sign-in/ports.js';
import { createStateParty } from '../mcp-out/state-party.js';
import { err, ok } from '../shared/result.js';
import { createCompletePartySignIn } from './complete-party-sign-in.js';
import { createListingConnectionOf } from './listing-connection.js';
import type { PartySignInUnderWay } from './ports.js';

const AT = new Date('2026-10-28T14:05:00.000Z');
const REDIRECT_URI = 'https://gateway.example.com/outside-parties/sign-in/done';

/** Each browser's shared sign-in, by the account it names in the fleet. */
const SIGNED_IN: Record<string, string | undefined> = { 'mathilde-browser': 'acc-mathilde', 'joris-browser': 'acc-joris' };

function accountOf({ signIn }: { signIn: string }) {
  const accountId = SIGNED_IN[signIn];
  return Promise.resolve(
    accountId === undefined ? err({ kind: 'signedOut' as const }) : ok<SharedAccountToken>({ accountToken: `token-${accountId}`, endsAt: new Date('2026-10-28T15:00:00.000Z'), accountId, personShipId: null, scopes: [] }),
  );
}

const seals = plainPartySignInSeals();

/** Mathilde's sign-in to Attio under way, sealed as the gateway sealed it when she pressed Sign in. */
function aSignIn(overrides: Partial<PartySignInUnderWay> = {}): string {
  return seals.seal({ fleetId: FLEET_ID, party: 'attio', accountId: 'acc-mathilde', personShipId: MATHILDE_SHIP_ID, verifier: 'verifier-1', expiresAt: new Date('2026-10-28T14:10:00.000Z'), ...overrides });
}

let parties: ReturnType<typeof memoryPartyStore>;
let grants: ReturnType<typeof memoryPartyGrants>;
let attio: ReturnType<typeof fakePartySignIns>;
let servers: ReturnType<typeof fakeMcpServers>;
let door: ReturnType<typeof fakeStatementDoor>;
let notices: ReturnType<typeof memorySignInNotices>;
let completing: ReturnType<typeof createCompletePartySignIn>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(anAttioParty());
  grants = memoryPartyGrants();
  notices = memorySignInNotices();
  attio = fakePartySignIns();
  servers = fakeMcpServers();
  door = fakeStatementDoor();
  const clock = { now: () => AT };
  const stateParty = createStateParty({ parties, servers, connectionOf: createListingConnectionOf({ grants, clock }), door, marks: memoryToolMarks(), requirements: memoryScopeRequirements(), timing: { waitMs: 10_000, deadlineMs: 300_000 } });
  completing = createCompletePartySignIn({ servers: signInServersOf(parties), grants, seals, signIns: attio.signIns, notices, accountOf, stateParty, clock, redirectUri: REDIRECT_URI });
});

function back(overrides: Partial<Parameters<typeof completing>[0]> = {}): ReturnType<typeof completing> {
  return completing({ state: aSignIn(), code: 'code-mathilde', error: undefined, iss: undefined, signIn: 'mathilde-browser', ...overrides });
}

describe('a person comes back from signing in to an outside MCP server (decision 0067)', () => {
  it('keeps their grant, naming their outside account, with its tokens and when its access token ends (scenario 6)', async () => {
    await expect(back()).resolves.toEqual({ isOk: true, value: { fleetId: FLEET_ID, party: 'attio', statementRefusal: null } });
    expect(grants.held).toEqual([
      aPartyGrant({
        outsideAccount: { subject: 'sub-1', name: 'mathilde@acme.example' },
        accessToken: 'access-mathilde',
        refreshToken: 'refresh-mathilde',
        accessTokenEndsAt: new Date('2026-10-28T15:05:00.000Z'),
        signedInAt: AT,
        lastUsedAt: null,
      }),
    ]);
  });

  it("redeems the code with the party's client, the sign-in's PKCE verifier and the redirect URI", async () => {
    await back();

    expect(attio.state.redeemed).toEqual([{ clientId: 'client-1', code: 'code-mathilde', verifier: 'verifier-1', redirectUri: REDIRECT_URI }]);
  });

  it("states the proxy ship from the grant, listing its tools under the grant's access token (scenario 4, Q15)", async () => {
    await back();

    expect(servers.listedWith).toEqual([{ url: 'https://mcp.attio.com/mcp', credential: { kind: 'bearer', token: 'access-mathilde' } }]);
    expect(door.stated.map(({ crewToken, statement }) => [crewToken, statement.capabilities.map((capability) => capability.name)])).toEqual([['aeolus_ct_v1_attio', ['list_contacts', 'create_deal']]]);
  });

  it('keeps the grant while the proxy ship cannot be stated, saying why', async () => {
    servers.state.isReachable = false;

    await expect(back()).resolves.toMatchObject({ isOk: true, value: { statementRefusal: 'The MCP server of attio could not be listed: connect ECONNREFUSED' } });
    expect(grants.held).toHaveLength(1);
  });

  it('keeps a grant naming no outside account when the server gave no ID token', async () => {
    attio.state.codes.set('code-mathilde', { ...MATHILDE_TOKENS, idToken: null, expiresInSeconds: null });

    await back();

    expect(grants.held).toMatchObject([{ outsideAccount: { subject: null, name: null }, accessTokenEndsAt: null }]);
  });

  it('replaces the grant the person held before (scenario 9)', async () => {
    await grants.keep(aPartyGrant({ accessToken: 'access-before', refreshToken: 'refresh-before' }));

    await back();

    expect(grants.held).toMatchObject([{ personShipId: MATHILDE_SHIP_ID, accessToken: 'access-mathilde', refreshToken: 'refresh-mathilde' }]);
  });

  it('closes the notice that told them a call needed their sign-in, so a later loss tells them again (Q6, scenario 9)', async () => {
    await notices.open(FLEET_ID, { party: 'attio', personShipId: MATHILDE_SHIP_ID, noticeId: 'notice-1' });
    await notices.markTold(FLEET_ID, { party: 'attio', personShipId: MATHILDE_SHIP_ID });

    await back();

    expect(notices.held).toEqual([]);
  });
});

describe('a sign-in that is turned away keeps nothing', () => {
  it("turns away a person signing in as an outside account another person's grant names, leaving that grant untouched (scenario 8, Q13)", async () => {
    await grants.keep(aPartyGrant({ personShipId: JORIS_SHIP_ID, accountId: 'acc-joris', accessToken: 'access-joris' }));

    const completed = await back();

    expect(completed).toMatchObject({ isOk: false, error: { kind: 'TURNED_AWAY', at: { fleetId: FLEET_ID, party: 'attio' } } });
    expect(grants.held).toEqual([aPartyGrant({ personShipId: JORIS_SHIP_ID, accountId: 'acc-joris', accessToken: 'access-joris' })]);
  });

  it('never redeems the code of a sign-in another browser started, saying why (scenario 7)', async () => {
    await expect(back({ signIn: 'joris-browser' })).resolves.toMatchObject({ isOk: false, error: { kind: 'SIGN_IN_FAILED', at: { fleetId: FLEET_ID, party: 'attio' } } });
    expect({ redeemed: attio.state.redeemed, grants: grants.held }).toEqual({ redeemed: [], grants: [] });
  });

  it('never redeems the code when the browser holds no shared sign-in', async () => {
    await expect(back({ signIn: undefined })).resolves.toMatchObject({ isOk: false, error: { kind: 'SIGN_IN_FAILED' } });
    expect(attio.state.redeemed).toEqual([]);
  });

  it('never redeems the code of a state the gateway did not seal', async () => {
    await expect(back({ state: 'made-up' })).resolves.toMatchObject({ isOk: false, error: { kind: 'SIGN_IN_FAILED', at: null } });
    expect(attio.state.redeemed).toEqual([]);
  });

  it('never redeems the code of a sign-in that took longer than ten minutes', async () => {
    await expect(back({ state: aSignIn({ expiresAt: AT }) })).resolves.toMatchObject({ isOk: false, error: { kind: 'SIGN_IN_FAILED', at: null } });
    expect(attio.state.redeemed).toEqual([]);
  });

  it('keeps the notice of a person turned away open, so they are not told again', async () => {
    await grants.keep(aPartyGrant({ personShipId: JORIS_SHIP_ID, accountId: 'acc-joris', accessToken: 'access-joris' }));
    await notices.open(FLEET_ID, { party: 'attio', personShipId: MATHILDE_SHIP_ID, noticeId: 'notice-1' });

    await back();

    expect(notices.held).toMatchObject([{ personShipId: MATHILDE_SHIP_ID, noticeId: 'notice-1' }]);
  });

  it('says the person is not signed in when they denied consent, keeping nothing (scenario 10)', async () => {
    await expect(back({ code: undefined, error: 'access_denied' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_SIGNED_IN', at: { fleetId: FLEET_ID, party: 'attio' }, serverError: 'access_denied' } });
    expect({ redeemed: attio.state.redeemed, grants: grants.held }).toEqual({ redeemed: [], grants: [] });
  });

  it("never redeems a code whose response names another issuer than the party's (RFC 9207)", async () => {
    await expect(back({ iss: 'https://evil.example.com' })).resolves.toMatchObject({ isOk: false, error: { kind: 'SIGN_IN_FAILED' } });
    expect(attio.state.redeemed).toEqual([]);
  });

  it('never redeems a code whose response names no issuer where the authorization server states it in each one', async () => {
    await parties.save(anAttioParty({ credential: { kind: 'personSignIn', client: { ...ATTIO_CLIENT, isIssuerInResponse: true } } }));

    await expect(back()).resolves.toMatchObject({ isOk: false, error: { kind: 'SIGN_IN_FAILED' } });
    expect(attio.state.redeemed).toEqual([]);
  });

  it("redeems a code whose response names the party's issuer", async () => {
    await parties.save(anAttioParty({ credential: { kind: 'personSignIn', client: { ...ATTIO_CLIENT, isIssuerInResponse: true } } }));

    await expect(back({ iss: 'https://app.attio.com' })).resolves.toMatchObject({ isOk: true });
  });

  it("says the sign-in failed with the server's error when the token endpoint refuses the code", async () => {
    await expect(back({ code: 'code-used' })).resolves.toMatchObject({ isOk: false, error: { kind: 'SIGN_IN_FAILED', serverError: 'invalid_grant' } });
    expect(grants.held).toEqual([]);
  });

  it('says the authorization server did not answer, keeping nothing', async () => {
    attio.state.failure = { kind: 'unreachable', reason: 'connect ECONNREFUSED' };

    await expect(back()).resolves.toMatchObject({ isOk: false, error: { kind: 'AUTHORIZATION_SERVER_UNREACHABLE', at: { fleetId: FLEET_ID, party: 'attio' } } });
    expect(grants.held).toEqual([]);
  });

  it("refuses an ID token another issuer issued, or one not for the party's client, keeping nothing", async () => {
    attio.state.codes.set('code-other-issuer', { ...MATHILDE_TOKENS, idToken: { ...MATHILDE_ID_TOKEN, issuer: 'https://evil.example.com' } });
    attio.state.codes.set('code-other-client', { ...MATHILDE_TOKENS, idToken: { ...MATHILDE_ID_TOKEN, audiences: ['client-2'] } });

    const completed = await Promise.all([back({ code: 'code-other-issuer' }), back({ code: 'code-other-client' })]);

    expect(completed).toMatchObject([
      { isOk: false, error: { kind: 'SIGN_IN_FAILED' } },
      { isOk: false, error: { kind: 'SIGN_IN_FAILED' } },
    ]);
    expect(grants.held).toEqual([]);
  });

  it('refuses a sign-in to a party the gateway no longer has, never redeeming', async () => {
    await parties.remove(FLEET_ID, 'attio');

    await expect(back()).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_PARTY' } });
    expect(attio.state.redeemed).toEqual([]);
  });
});
