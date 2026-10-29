import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { memoryIssuedTokens } from '../../../test/support/oauth-fakes.js';
import { fakeProxyShipsAsActor, memoryPartyStore, PROXY_SHIP_ID } from '../../../test/support/party-fakes.js';
import { ATTIO_CLIENT, aPartyGrant, anAttioParty, fakePartySignIns, memoryPartyGrants } from '../../../test/support/party-grant-fakes.js';
import { createEndPartyGrants } from '../party-grants/end-party-grants.js';
import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential } from '../actors/credential-of.js';
import { err, ok } from '../shared/result.js';
import type { McpClientParty, McpServerParty } from './party.js';
import { createRetireParty } from './retire-party.js';

// An actor holding fleet:manage retires an outside party (decision 0056):
// its proxy ship is retired in the fleet, as the actor, within its manage
// reach, and the gateway forgets the party. Adding it again is a new
// request. A client party's tokens are revoked with it.

const AT = new Date('2026-10-20T12:00:00.000Z');
const MANAGER: Actor = { fleetId: FLEET_ID, kind: 'ship', shipId: 'shp_01m3tbfspe96yf1rnr4ank9mgr', scopes: ['fleet:manage'] };
const AS: ActorCredential = { crewToken: 'aeolus_ct_v1_manager' };
const CRM: McpServerParty = {
  fleetId: FLEET_ID,
  name: 'crm',
  kind: 'mcpServer',
  url: 'https://crm.example.com/mcp',
  credential: { kind: 'bearer', token: 't' },
  concurrencyLimit: 4,
  toolSwitches: null,
  state: 'crewed',
  proxyShipId: PROXY_SHIP_ID,
  secret: null,
  crewToken: 'aeolus_ct_v1_crm',
  requestId: 'req_1',
  requestHash: 'h',
  approvedAt: AT,
};
const ORDERBOT: McpClientParty = { ...CRM, name: 'orderbot', kind: 'mcpClient', clientId: 'https://orderbot.example.com/client.json' };

let parties: ReturnType<typeof memoryPartyStore>;
let tokens: ReturnType<typeof memoryIssuedTokens>;
let grants: ReturnType<typeof memoryPartyGrants>;
let attio: ReturnType<typeof fakePartySignIns>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(CRM);
  tokens = memoryIssuedTokens();
  grants = memoryPartyGrants();
  await grants.keep(aPartyGrant());
  attio = fakePartySignIns();
});

function retireParty(fleet = fakeProxyShipsAsActor()) {
  return {
    fleet,
    retireParty: createRetireParty({
      parties,
      fleet,
      tokens,
      endPartyGrants: createEndPartyGrants({ grants, signIns: attio.signIns }),
      credentialOf: (actor, sent) => Promise.resolve(ok(actor.kind === 'account' ? { crewToken: 'aeolus_ct_v1_gateway', accountToken: 'account-token-1' } : sent)),
    }),
  };
}

describe('retiring an outside party', () => {
  it('retires its proxy ship in the fleet as the actor, then forgets the party', async () => {
    const { fleet, retireParty: retire } = retireParty();

    await expect(retire({ actor: MANAGER, as: AS, name: 'crm' })).resolves.toEqual({ isOk: true, value: undefined });
    expect({ retired: fleet.retired, parties: [...parties.held.keys()] }).toEqual({ retired: [{ as: AS, shipId: PROXY_SHIP_ID }], parties: [] });
  });

  it("retires it as an account on the gateway's pages, by its account token", async () => {
    const { fleet, retireParty: retire } = retireParty();
    const charlotte: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-charlotte', personShipId: null, accountToken: 'account-token-1', scopes: ['fleet:manage'] };

    await retire({ actor: charlotte, as: { cookie: 'aeolus_account_session=charlotte' }, name: 'crm' });

    expect(fleet.retired.map(({ as }) => as)).toEqual([{ crewToken: 'aeolus_ct_v1_gateway', accountToken: 'account-token-1' }]);
  });

  it("revokes a client party's tokens with it, so its client is refused", async () => {
    await parties.save(ORDERBOT);
    const pair = { codeHash: 'code-1', fleetId: FLEET_ID, clientId: ORDERBOT.clientId, resource: 'https://gateway.example.com/mcp', scope: null, accessExpiresAt: AT, refreshExpiresAt: AT, kind: 'party' as const };
    await tokens.save({ ...pair, familyId: 'family-1', party: 'orderbot', accessHash: 'access-1', refreshHash: 'refresh-1' });
    await tokens.save({ ...pair, familyId: 'family-2', party: 'crm', accessHash: 'access-2', refreshHash: 'refresh-2' });

    await retireParty().retireParty({ actor: MANAGER, as: AS, name: 'orderbot' });

    expect(tokens.held).toMatchObject([
      { party: 'orderbot', state: 'revoked' },
      { party: 'crm', state: 'active' },
    ]);
  });

  it("ends every person's grant of a server where each person signs in, and deletes its client where offered (decision 0067, scenario 31)", async () => {
    const client = { ...ATTIO_CLIENT, registrationClientUri: 'https://app.attio.com/oauth/register/client-1', registrationAccessToken: 'registration-token-1' };
    await parties.save(anAttioParty({ credential: { kind: 'personSignIn', client } }));

    await expect(retireParty().retireParty({ actor: MANAGER, as: AS, name: 'attio' })).resolves.toEqual({ isOk: true, value: undefined });
    expect({ grants: grants.held, deleted: attio.state.deletedClients.map(({ registrationClientUri }) => registrationClientUri), parties: [...parties.held.keys()] }).toEqual({
      grants: [],
      deleted: ['https://app.attio.com/oauth/register/client-1'],
      parties: [`${FLEET_ID}/crm`],
    });
  });

  it("keeps every grant when the fleet refuses to retire the server's proxy ship", async () => {
    await parties.save(anAttioParty());
    const { retireParty: retire } = retireParty(fakeProxyShipsAsActor(err({ code: 'FORBIDDEN', message: 'The network rules do not allow this manage' })));

    await retire({ actor: MANAGER, as: AS, name: 'attio' });

    expect(grants.held).toHaveLength(1);
  });

  it('refuses an actor without fleet:manage, asking the fleet nothing', async () => {
    const { fleet, retireParty: retire } = retireParty();

    await expect(retire({ actor: { ...MANAGER, scopes: ['fleet:read'] }, as: AS, name: 'crm' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_A_MANAGER' } });
    expect({ retired: fleet.retired, parties: [...parties.held.keys()] }).toEqual({ retired: [], parties: [`${FLEET_ID}/crm`] });
  });

  it('refuses a party the gateway does not know', async () => {
    await expect(retireParty().retireParty({ actor: MANAGER, as: AS, name: 'nobody' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_PARTY' } });
  });

  it('keeps the party when the fleet refuses to retire its proxy ship, saying why', async () => {
    const { retireParty: retire } = retireParty(fakeProxyShipsAsActor(err({ code: 'FORBIDDEN', message: 'The network rules do not allow this manage' })));

    await expect(retire({ actor: MANAGER, as: AS, name: 'crm' })).resolves.toEqual({ isOk: false, error: { kind: 'RETIRE_REFUSED', message: 'The network rules do not allow this manage' } });
    expect([...parties.held.keys()]).toEqual([`${FLEET_ID}/crm`]);
  });

  it('keeps the party when the fleet does not answer', async () => {
    const { retireParty: retire } = retireParty(fakeProxyShipsAsActor(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' })));

    await expect(retire({ actor: MANAGER, as: AS, name: 'crm' })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
    expect([...parties.held.keys()]).toEqual([`${FLEET_ID}/crm`]);
  });

  it('forgets a party whose proxy ship the fleet retired already', async () => {
    const { retireParty: retire } = retireParty(fakeProxyShipsAsActor(err({ code: 'CONFLICT', message: 'crm is retired already: a retired ship stays retired' })));

    await expect(retire({ actor: MANAGER, as: AS, name: 'crm' })).resolves.toEqual({ isOk: true, value: undefined });
    expect([...parties.held.keys()]).toEqual([]);
  });

  it('forgets a party whose proxy ship the gateway never learned, asking the fleet nothing', async () => {
    await parties.save({ ...CRM, state: 'commissioning', proxyShipId: null, crewToken: null });
    const { fleet, retireParty: retire } = retireParty();

    await expect(retire({ actor: MANAGER, as: AS, name: 'crm' })).resolves.toEqual({ isOk: true, value: undefined });
    expect({ retired: fleet.retired, parties: [...parties.held.keys()] }).toEqual({ retired: [], parties: [] });
  });
});
