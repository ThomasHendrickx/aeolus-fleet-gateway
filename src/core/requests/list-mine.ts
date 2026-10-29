import type { Actor } from '../actors/authenticate-actor.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { PendingRequest, PendingRequests } from './ports.js';
import { stateAt } from './request-state.js';

export type ListMine = (actor: Actor) => Promise<Result<PendingRequest[], DomainError<'NOT_AN_ACCOUNT'>>>;

/**
 * Use case: the requests an account asked, in any state, the newest first
 * (decision 0056: Your requests on the overview). One still pending past its
 * 7 days reads as expired, as the store marks it only when it is next
 * opened. Only an account asks, so any other actor has none.
 */
export function createListMine(deps: { requests: PendingRequests; clock: Clock }): ListMine {
  return async (actor) => {
    if (actor.kind !== 'account') {
      return refuse('NOT_AN_ACCOUNT', 'Only a person signed in to the gateway has requests of their own');
    }
    const now = deps.clock.now();
    const mine = await deps.requests.listMine(actor.fleetId, actor.accountId);
    return ok(mine.map((request) => ({ ...request, state: stateAt(request, now) })));
  };
}
