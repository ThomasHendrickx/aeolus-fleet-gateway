import type { ShipId } from '@aeolus-fleet/common';

import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential, CredentialOf } from '../actors/credential-of.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { FleetShip, FleetShips } from './ports.js';

/** A ship a party's proxy ship may be owned by, by its name. */
export interface OwnerChoice {
  shipId: ShipId;
  name: string;
}

export type ListOwnerChoices = (call: { actor: Actor; as: ActorCredential }) => Promise<Result<OwnerChoice[], DomainError<'FLEET_UNAVAILABLE'>>>;

/** Whether the fleet takes the ship as an owner: an active person's ship or argo (decision 0045). */
function isOwnerChoice(ship: FleetShip): boolean {
  return (ship.kind === 'operator' || ship.kind === 'person') && ship.status !== 'retired';
}

/**
 * Use case: the ships the actor may pick as a party's owner, by name, from
 * the fleet's ships read as the actor, so only ships within its read reach.
 * The fleet still decides each owner it is asked to set.
 */
export function createListOwnerChoices(deps: { ships: FleetShips; credentialOf: CredentialOf }): ListOwnerChoices {
  return async ({ actor, as }) => {
    const credential = await deps.credentialOf(actor, as);
    if (!credential.isOk) {
      return credential;
    }
    const listed = await deps.ships.list(credential.value);
    if (!listed.isOk) {
      return refuse('FLEET_UNAVAILABLE', `The fleet did not list its ships: ${listed.error.message}`);
    }
    return ok(listed.value.filter(isOwnerChoice).map(({ shipId, name }) => ({ shipId, name })));
  };
}
