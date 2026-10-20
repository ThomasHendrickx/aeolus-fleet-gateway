import type { Actor } from '../actors/authenticate-actor.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { APPROVING_SCOPE } from './decide-request.js';
import type { PendingRequest, PendingRequests } from './ports.js';

export type ListToDecide = (actor: Actor) => Promise<Result<PendingRequest[], DomainError<'NOT_AN_APPROVER'>>>;

/** Use case: every open request of the fleet, for an actor holding gateway:approve (decision 0056: To decide on the overview). */
export function createListToDecide(deps: { requests: PendingRequests; clock: Clock }): ListToDecide {
  return async (actor) => {
    if (!actor.scopes.includes(APPROVING_SCOPE)) {
      return refuse('NOT_AN_APPROVER', `Deciding requests needs ${APPROVING_SCOPE}`);
    }
    return ok(await deps.requests.listOpen(actor.fleetId, deps.clock.now()));
  };
}
