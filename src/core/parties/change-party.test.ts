import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { FLEET_ID } from '../../../test/support/fleet-fakes.js';
import { fakeProxyShipsAsActor, memoryPartyStore, PROXY_SHIP_ID } from '../../../test/support/party-fakes.js';
import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential } from '../actors/credential-of.js';
import { err, ok } from '../shared/result.js';
import { createChangePartyOwner, createChangePartyScopes } from './change-party.js';
import type { McpServerParty } from './party.js';

// Changing an outside party takes the usual scopes on its proxy ship, within
// manage reach (decision 0056): fleet:owner changes its owner, scopes:grant
// its scopes, only scopes the actor holds. The gateway asks the fleet as the
// actor, so the fleet checks both; what the fleet holds is the answer.

const AT = new Date('2026-10-20T12:00:00.000Z');
const NEW_OWNER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9new';
const ACTOR: Actor = { fleetId: FLEET_ID, kind: 'ship', shipId: 'shp_01m3tbfspe96yf1rnr4ank9mgr', scopes: ['fleet:owner', 'scopes:grant', 'fleet:read'] };
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

let parties: ReturnType<typeof memoryPartyStore>;

beforeEach(async () => {
  parties = memoryPartyStore();
  await parties.save(CRM);
});

function deps(fleet = fakeProxyShipsAsActor()) {
  return {
    fleet,
    deps: {
      parties,
      fleet,
      credentialOf: (actor: Actor, sent: ActorCredential) => Promise.resolve(ok(actor.kind === 'account' ? { crewToken: 'aeolus_ct_v1_gateway', accountToken: 'account-token-1' } : sent)),
    },
  };
}

describe("changing an outside party's owner", () => {
  it('sets the owner of its proxy ship in the fleet, as the actor', async () => {
    const { fleet, deps: given } = deps();

    await expect(createChangePartyOwner(given)({ actor: ACTOR, as: AS, name: 'crm', ownerShipId: NEW_OWNER })).resolves.toEqual({ isOk: true, value: undefined });
    expect(fleet.owned).toEqual([{ as: AS, shipId: PROXY_SHIP_ID, ownerShipId: NEW_OWNER }]);
  });

  it("sets it as an account on the gateway's pages, by its account token", async () => {
    const { fleet, deps: given } = deps();
    const charlotte: Actor = { fleetId: FLEET_ID, kind: 'account', accountId: 'acc-charlotte', personShipId: null, accountToken: 'account-token-1', scopes: ['fleet:owner'] };

    await createChangePartyOwner(given)({ actor: charlotte, as: { cookie: 'aeolus_account_session=charlotte' }, name: 'crm', ownerShipId: NEW_OWNER });

    expect(fleet.owned.map(({ as }) => as)).toEqual([{ crewToken: 'aeolus_ct_v1_gateway', accountToken: 'account-token-1' }]);
  });

  it('refuses an actor without fleet:owner, asking the fleet nothing', async () => {
    const { fleet, deps: given } = deps();

    await expect(createChangePartyOwner(given)({ actor: { ...ACTOR, scopes: ['fleet:manage'] }, as: AS, name: 'crm', ownerShipId: NEW_OWNER })).resolves.toMatchObject({ isOk: false, error: { kind: 'SCOPE_NOT_HELD' } });
    expect(fleet.owned).toEqual([]);
  });

  it('says why the fleet refuses, such as an owner that is no person ship', async () => {
    const { deps: given } = deps(fakeProxyShipsAsActor(err({ code: 'BAD_REQUEST', message: "An owner is an active person's ship or argo" })));

    await expect(createChangePartyOwner(given)({ actor: ACTOR, as: AS, name: 'crm', ownerShipId: NEW_OWNER })).resolves.toEqual({ isOk: false, error: { kind: 'CHANGE_REFUSED', message: "An owner is an active person's ship or argo" } });
  });
});

describe("changing an outside party's scopes", () => {
  it('grants and revokes scopes on its proxy ship in the fleet, as the actor, answering every scope it holds now', async () => {
    const { fleet, deps: given } = deps();

    await expect(createChangePartyScopes(given)({ actor: ACTOR, as: AS, name: 'crm', grant: ['fleet:read'], revoke: ['labels:assign'] })).resolves.toEqual({ isOk: true, value: { scopes: ['messages:send', 'messages:receive', 'fleet:read'] } });
    expect(fleet.granted).toEqual([{ as: AS, shipId: PROXY_SHIP_ID, grant: ['fleet:read'], revoke: ['labels:assign'] }]);
  });

  it('refuses an actor without scopes:grant, asking the fleet nothing', async () => {
    const { fleet, deps: given } = deps();

    await expect(createChangePartyScopes(given)({ actor: { ...ACTOR, scopes: ['fleet:owner'] }, as: AS, name: 'crm', grant: ['fleet:read'], revoke: [] })).resolves.toMatchObject({ isOk: false, error: { kind: 'SCOPE_NOT_HELD' } });
    expect(fleet.granted).toEqual([]);
  });

  it('says when the fleet does not answer', async () => {
    const { deps: given } = deps(fakeProxyShipsAsActor(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' })));

    await expect(createChangePartyScopes(given)({ actor: ACTOR, as: AS, name: 'crm', grant: ['fleet:read'], revoke: [] })).resolves.toMatchObject({ isOk: false, error: { kind: 'FLEET_UNAVAILABLE' } });
  });
});

describe('a party either change cannot reach', () => {
  it('refuses a party the gateway does not know', async () => {
    await expect(createChangePartyOwner(deps().deps)({ actor: ACTOR, as: AS, name: 'nobody', ownerShipId: NEW_OWNER })).resolves.toMatchObject({ isOk: false, error: { kind: 'NO_SUCH_PARTY' } });
  });

  it('refuses a party whose proxy ship is not commissioned yet, asking the fleet nothing', async () => {
    await parties.save({ ...CRM, state: 'commissioning', proxyShipId: null, crewToken: null });
    const { fleet, deps: given } = deps();

    await expect(createChangePartyScopes(given)({ actor: ACTOR, as: AS, name: 'crm', grant: ['fleet:read'], revoke: [] })).resolves.toMatchObject({ isOk: false, error: { kind: 'PARTY_NOT_COMMISSIONED' } });
    expect(fleet.granted).toEqual([]);
  });
});
