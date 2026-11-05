import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential, CredentialOf } from '../actors/credential-of.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { ActiveShips } from './ports.js';

export type ReadFleetAlertCount = (call: { actor: Actor; as: ActorCredential }) => Promise<Result<number, DomainError<'FLEET_UNAVAILABLE' | 'SCOPE_NOT_HELD'>>>;

/**
 * Use case: the number of ships with an alert, for the sidebar of every
 * Bridge page. The fleet counts it, as the person's account, so the cost
 * does not grow with the number of ships and the fleet decides which ships
 * count.
 */
export function createReadFleetAlertCount(deps: { ships: ActiveShips; credentialOf: CredentialOf }): ReadFleetAlertCount {
  return async ({ actor, as }) => {
    const credential = await deps.credentialOf(actor, as);
    if (!credential.isOk) {
      return credential;
    }
    const counted = await deps.ships.alertCount(credential.value);
    if (!counted.isOk) {
      return counted.error.code === 'FORBIDDEN' ? refuse('SCOPE_NOT_HELD', counted.error.message) : refuse('FLEET_UNAVAILABLE', `The fleet did not count its alerts: ${counted.error.message}`);
    }
    return ok(counted.value);
  };
}
