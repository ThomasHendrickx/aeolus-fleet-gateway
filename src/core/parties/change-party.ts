/**
 * Changing an outside party (decision 0056): the usual scopes on its proxy
 * ship, within manage reach. fleet:owner changes its owner, scopes:grant its
 * scopes, only scopes the actor holds. The gateway checks the actor holds
 * the call's scope, then asks the fleet as the actor, which checks the rest;
 * the gateway keeps nothing of either, as the fleet's are the answer.
 */
import type { ShipId } from '@aeolus-fleet/common';

import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential, CredentialOf } from '../actors/credential-of.js';
import type { FleetRefusal } from '../connection/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { err, ok, type Result } from '../shared/result.js';
import type { PartyStore, ProxyShipsAsActor } from './ports.js';

/** The scope that changes an outside party's owner (0053). */
export const OWNING_SCOPE = 'fleet:owner';

/** The scope that grants and revokes an outside party's scopes (0046). */
export const GRANTING_SCOPE = 'scopes:grant';

export type ChangePartyRefusal = DomainError<'SCOPE_NOT_HELD' | 'NO_SUCH_PARTY' | 'PARTY_NOT_COMMISSIONED' | 'CHANGE_REFUSED' | 'FLEET_UNAVAILABLE' | 'NOT_AN_ACTOR'>;

interface ChangeDeps {
  parties: PartyStore;
  fleet: ProxyShipsAsActor;
  credentialOf: CredentialOf;
}

interface ChangeCall {
  actor: Actor;
  as: ActorCredential;
  name: string;
}

export type ChangePartyOwner = (input: ChangeCall & { ownerShipId: ShipId }) => Promise<Result<undefined, ChangePartyRefusal>>;

export type ChangePartyScopes = (input: ChangeCall & { grant: readonly string[]; revoke: readonly string[] }) => Promise<Result<{ scopes: string[] }, ChangePartyRefusal>>;

/** The party's proxy ship and the credential to call the fleet on it with as the actor, who holds the call's scope. */
async function proxyShipFor(deps: ChangeDeps, call: ChangeCall & { scope: string }): Promise<Result<{ shipId: ShipId; credential: ActorCredential }, ChangePartyRefusal>> {
  const { actor, as, name, scope } = call;
  if (!actor.scopes.includes(scope)) {
    return refuse('SCOPE_NOT_HELD', `Changing an outside party this way needs ${scope}`);
  }
  const party = await deps.parties.find(actor.fleetId, name);
  if (party === undefined) {
    return refuse('NO_SUCH_PARTY', `There is no outside party ${name}`);
  }
  if (party.proxyShipId === null) {
    return refuse('PARTY_NOT_COMMISSIONED', `${name}'s proxy ship is not commissioned yet`);
  }
  const credential = await deps.credentialOf(actor, as);
  return credential.isOk ? ok({ shipId: party.proxyShipId, credential: credential.value }) : credential;
}

/** The fleet's refusal of a change, as the gateway states it. */
function refusalOf(refusal: FleetRefusal): ChangePartyRefusal {
  return refusal.code === 'UNAVAILABLE' ? { kind: 'FLEET_UNAVAILABLE', message: `The fleet did not answer: ${refusal.message}` } : { kind: 'CHANGE_REFUSED', message: refusal.message };
}

/** Use case: an actor holding fleet:owner sets the owner of an outside party's proxy ship, as itself. */
export function createChangePartyOwner(deps: ChangeDeps): ChangePartyOwner {
  return async ({ ownerShipId, ...call }) => {
    const target = await proxyShipFor(deps, { ...call, scope: OWNING_SCOPE });
    if (!target.isOk) {
      return target;
    }
    const set = await deps.fleet.setOwner(target.value.credential, { shipId: target.value.shipId, ownerShipId });
    return set.isOk ? ok(undefined) : err(refusalOf(set.error));
  };
}

/** Use case: an actor holding scopes:grant grants and revokes scopes on an outside party's proxy ship, as itself: every scope it holds now. */
export function createChangePartyScopes(deps: ChangeDeps): ChangePartyScopes {
  return async ({ grant, revoke, ...call }) => {
    const target = await proxyShipFor(deps, { ...call, scope: GRANTING_SCOPE });
    if (!target.isOk) {
      return target;
    }
    const changed = await deps.fleet.grantScopes(target.value.credential, { shipId: target.value.shipId, grant, revoke });
    return changed.isOk ? ok(changed.value) : err(refusalOf(changed.error));
  };
}
