import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential, CredentialOf } from '../actors/credential-of.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { FleetRetention, Retention } from './ports.js';

export type ReadFleetRetention = (call: { actor: Actor; as: ActorCredential }) => Promise<Result<Retention, DomainError<'FLEET_UNAVAILABLE' | 'SCOPE_NOT_HELD'>>>;

/**
 * Use case: a person reads the fleet's retention as their account
 * (fleet:read), so a client can tell where an exchange's history ends: at its
 * true start, or where the fleet no longer keeps earlier messages. The fleet
 * answers it, so the gateway adds no reach of its own.
 */
export function createReadFleetRetention(deps: { retention: FleetRetention; credentialOf: CredentialOf }): ReadFleetRetention {
  return async ({ actor, as }) => {
    const credential = await deps.credentialOf(actor, as);
    if (!credential.isOk) {
      return credential;
    }
    const read = await deps.retention.retention(credential.value);
    if (!read.isOk) {
      return read.error.code === 'FORBIDDEN' ? refuse('SCOPE_NOT_HELD', read.error.message) : refuse('FLEET_UNAVAILABLE', `The fleet did not answer its retention: ${read.error.message}`);
    }
    return ok(read.value);
  };
}
