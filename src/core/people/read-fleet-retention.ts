import type { Actor } from '../actors/authenticate-actor.js';
import type { ActorCredential, CredentialOf } from '../actors/credential-of.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { FleetRetention, Retention } from './ports.js';

export type ReadFleetRetention = (call: { actor: Actor; as: ActorCredential }) => Promise<Result<Retention, DomainError<'FLEET_UNAVAILABLE' | 'SCOPE_NOT_HELD'>>>;

/**
 * How long one answer is shared by every person of a fleet. Retention is
 * configuration that changes rarely, and core's fleet.limits also counts the
 * fleet's ships, so a hot path must not call it per read: a change shows to
 * a client within this time.
 */
const RETENTION_SHARED_MS = 5 * 60 * 1000;

/**
 * Use case: a person reads the fleet's retention as their account
 * (fleet:read), so a client can tell where an exchange's history ends: at its
 * true start, or where the fleet no longer keeps earlier messages. The fleet
 * answers it, so the gateway adds no reach of its own. One answer per fleet
 * is kept for a few minutes and shared; it serves only a person whose account
 * holds fleet:read, and any other person is read through to core, which
 * decides.
 */
export function createReadFleetRetention(deps: { retention: FleetRetention; credentialOf: CredentialOf; clock: Clock }): ReadFleetRetention {
  const answers = new Map<Actor['fleetId'], { readonly retention: Retention; readonly endsAt: number }>();
  return async ({ actor, as }) => {
    const held = answers.get(actor.fleetId);
    if (held !== undefined && held.endsAt > deps.clock.now().getTime() && actor.scopes.includes('fleet:read')) {
      return ok(held.retention);
    }
    const credential = await deps.credentialOf(actor, as);
    if (!credential.isOk) {
      return credential;
    }
    const read = await deps.retention.retention(credential.value);
    if (!read.isOk) {
      return read.error.code === 'FORBIDDEN' ? refuse('SCOPE_NOT_HELD', read.error.message) : refuse('FLEET_UNAVAILABLE', `The fleet did not answer its retention: ${read.error.message}`);
    }
    answers.set(actor.fleetId, { retention: read.value, endsAt: deps.clock.now().getTime() + RETENTION_SHARED_MS });
    return ok(read.value);
  };
}
