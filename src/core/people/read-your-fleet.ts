import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential, CredentialOf } from '../actors/credential-of.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { ActiveShips } from './ports.js';
import { yourFleetOf, type YourFleet } from './your-fleet.js';

export type ReadYourFleet = (call: { actor: Actor; as: ActorCredential }) => Promise<Result<YourFleet, DomainError<'FLEET_UNAVAILABLE' | 'SCOPE_NOT_HELD'>>>;

/**
 * Use case: a person reads Your fleet (Bridge home) as their account
 * (fleet:read), so the fleet decides which ships they read and the gateway
 * adds no reach of its own. An account the fleet refuses holds no fleet:read.
 */
export function createReadYourFleet(deps: { ships: ActiveShips; credentialOf: CredentialOf }): ReadYourFleet {
  return async ({ actor, as }) => {
    const credential = await deps.credentialOf(actor, as);
    if (!credential.isOk) {
      return credential;
    }
    const listed = await deps.ships.list(credential.value);
    if (!listed.isOk) {
      return listed.error.code === 'FORBIDDEN' ? refuse('SCOPE_NOT_HELD', listed.error.message) : refuse('FLEET_UNAVAILABLE', `The fleet did not list its ships: ${listed.error.message}`);
    }
    return ok(yourFleetOf(listed.value));
  };
}
