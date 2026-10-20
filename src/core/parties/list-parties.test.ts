import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID, OTHER_FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeProxyShipReads, OWNER_SHIP_ID, PROXY_SHIP_ID, memoryPartyStore } from '../../../test/support/party-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential, CredentialOf } from '../actors/credential-of.js';
import { ok } from '../shared/result.js';
import type { McpServerParty } from './party.js';
import { createListParties, createReadParty } from './list-parties.js';

// The fleet's outside parties as an actor reads them: never a credential, a
// secret or a crew token. Each proxy ship's owner and scopes are core's
// alone (decision 0056), read as the actor, so the fleet answers within its
// read reach; the gateway keeps no owner of its own.

const AT = new Date('2026-10-18T13:00:00.000Z');
const ERP_SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9erp';
const SHIP: Actor = { fleetId: FLEET_ID, kind: 'ship', shipId: 'shp_01m3tbfspe96yf1rnr4ank9agt', scopes: ['fleet:read'] };
const SHIP_CREDENTIAL: ActorCredential = { crewToken: 'aeolus_ct_v1_agent' };
const ACCOUNT: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-charlotte', personShipId: null, grantId: 'grant-1', scopes: ['fleet:read'] };
const ACCOUNT_CREDENTIAL: ActorCredential = { crewToken: 'aeolus_ct_v1_gateway', accountToken: 'account-token-1' };

function aParty(overrides: Partial<McpServerParty>): McpServerParty {
  return {
    fleetId: FLEET_ID,
    name: 'crm',
    kind: 'mcpServer',
    url: 'https://crm.example.com/mcp',
    credential: { kind: 'bearer', token: 'crm-token' },
    concurrencyLimit: 4,
    state: 'crewed',
    proxyShipId: PROXY_SHIP_ID,
    secret: null,
    crewToken: 'aeolus_ct_v1_proxy',
    requestId: 'a-1',
    requestHash: 'h',
    approvedAt: AT,
    ...overrides,
  };
}

let parties: ReturnType<typeof memoryPartyStore>;

beforeEach(() => {
  parties = memoryPartyStore();
});

/** The ship an actor reads as, and what its read reach holds: the CRM's proxy ship, and the ERP's, which no actor reaches here. */
const reads = () =>
  fakeProxyShipReads({ [PROXY_SHIP_ID]: { ownerShipId: OWNER_SHIP_ID, scopes: ['messages:send', 'messages:receive', 'fleet:read'] }, [ERP_SHIP_ID]: { ownerShipId: null, scopes: ['messages:send'] } }, { outsideReach: [ERP_SHIP_ID] });

/** Calls the fleet as the actor: a ship with its own crew token, an account with its token presented by the gateway's ship. */
const credentialOf: CredentialOf = (actor, sent) => Promise.resolve(actor.kind === 'account' ? ok(ACCOUNT_CREDENTIAL) : ok(sent));

function listParties(fleet: ReturnType<typeof reads>, actor: Actor = SHIP) {
  return createListParties({ parties, fleet, credentialOf })({ actor, as: SHIP_CREDENTIAL });
}

describe("an actor reads its fleet's outside parties", () => {
  it("lists its fleet's parties by name, never another fleet's, each with the owner and scopes the fleet holds for its proxy ship, read as the actor", async () => {
    await parties.save(aParty({ name: 'crm' }));
    await parties.save(aParty({ name: 'other', fleetId: OTHER_FLEET_ID }));
    const fleet = reads();

    await expect(listParties(fleet)).resolves.toEqual([
      { name: 'crm', kind: 'mcpServer', url: 'https://crm.example.com/mcp', credentialKind: 'bearer', concurrencyLimit: 4, state: 'crewed', proxyShipId: PROXY_SHIP_ID, ownerShipId: OWNER_SHIP_ID, scopes: ['messages:send', 'messages:receive', 'fleet:read'] },
    ]);
    expect(fleet.readers).toEqual([SHIP_CREDENTIAL]);
  });

  it("reads them as an account with its account token, presented by the gateway's ship", async () => {
    await parties.save(aParty({}));
    const fleet = reads();

    await listParties(fleet, ACCOUNT);

    expect(fleet.readers).toEqual([ACCOUNT_CREDENTIAL]);
  });

  it("knows no owner or scopes of a party whose proxy ship is outside the actor's read reach (Q-R1)", async () => {
    await parties.save(aParty({ name: 'erp', proxyShipId: ERP_SHIP_ID }));

    await expect(listParties(reads())).resolves.toMatchObject([{ name: 'erp', ownerShipId: null, scopes: null }]);
  });

  it('knows no owner or scopes of a party whose proxy ship is not commissioned yet, asking the fleet nothing', async () => {
    await parties.save(aParty({ state: 'commissioning', proxyShipId: null, crewToken: null }));
    const fleet = reads();

    await expect(listParties(fleet)).resolves.toMatchObject([{ name: 'crm', ownerShipId: null, scopes: null }]);
    expect(fleet.readers).toEqual([]);
  });

  it('knows no owner or scopes while the fleet does not answer', async () => {
    await parties.save(aParty({}));

    await expect(listParties(fakeProxyShipReads({}))).resolves.toMatchObject([{ ownerShipId: null, scopes: null }]);
  });
});

describe('an actor reads one outside party', () => {
  it('reads it by name, with its owner and scopes from the fleet', async () => {
    await parties.save(aParty({}));

    await expect(createReadParty({ parties, fleet: reads(), credentialOf })({ actor: SHIP, as: SHIP_CREDENTIAL, name: 'crm' })).resolves.toMatchObject({
      isOk: true,
      value: { name: 'crm', ownerShipId: OWNER_SHIP_ID, scopes: ['messages:send', 'messages:receive', 'fleet:read'] },
    });
  });

  it('refuses a party the gateway does not know', async () => {
    await expect(createReadParty({ parties, fleet: reads(), credentialOf })({ actor: SHIP, as: SHIP_CREDENTIAL, name: 'nobody' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_PARTY' } });
  });
});
