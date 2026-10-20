import type { Clock } from '../shared/clock.js';
import { noticesOf } from './outcome-notice.js';
import type { PendingRequests } from './ports.js';

/** Expires the requests due by now: how many it expired. */
export type ExpireRequests = () => Promise<number>;

/**
 * Use case: a request no approver decided in 7 days expires (decision 0056),
 * in every fleet, with its outcomes to tell in the same step, so a person who
 * asked for a server hears it as they hear a decision (P5-1 a). A request
 * decided meanwhile is not expired.
 */
export function createExpireRequests(deps: { requests: PendingRequests; clock: Clock }): ExpireRequests {
  return async () => {
    const now = deps.clock.now();
    let expired = 0;
    for (const request of await deps.requests.listDue(now)) {
      const notices = noticesOf(request, { outcome: 'expired', partyName: null });
      if (await deps.requests.expire(request.fleetId, { requestId: request.requestId, now, notices })) {
        expired += 1;
      }
    }
    return expired;
  };
}
