import { describe, expect, it } from 'vitest';

import { changesOf } from './scope-changes';

const OWNER = 'shp_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_OWNER = 'shp_01m3tb1zgr5h2ffee12xnch8sw';

const aParty = { ownerShipId: OWNER, scopes: ['messages:send', 'messages:receive', 'fleet:read'] };

describe("what a party's change form asks of the API", () => {
  it('asks only what differs: a new owner, and the ticked scopes the party lacks, the unticked ones it holds', () => {
    const form = { ownerShipId: ` ${OTHER_OWNER} `, scopesShown: 'true', 'scope:tools:call': 'on' };

    expect(changesOf(aParty, { form, scopes: ['fleet:read', 'tools:call'] })).toEqual({ kind: 'changes', ownerShipId: OTHER_OWNER, grant: ['tools:call'], revoke: ['fleet:read'] });
  });

  it('asks nothing of a form that sends the owner it has and no scope rows', () => {
    expect(changesOf(aParty, { form: { ownerShipId: OWNER }, scopes: ['fleet:read'] })).toEqual({ kind: 'changes', grant: [], revoke: [] });
  });

  it('never revokes the scopes every app ship gets, nor one the actor does not hold', () => {
    const party = { ownerShipId: OWNER, scopes: ['messages:send', 'messages:receive', 'fleet:manage'] };

    expect(changesOf(party, { form: { scopesShown: 'true' }, scopes: ['messages:send', 'fleet:read'] })).toEqual({ kind: 'changes', grant: [], revoke: [] });
  });

  it('refuses an owner that is not a ship id', () => {
    expect(changesOf(aParty, { form: { ownerShipId: 'argo' }, scopes: [] })).toEqual({ kind: 'refused', message: "The owner's ship id is not a ship id (shp_...)" });
  });
});
