import type { FleetId } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import type { PendingRequest, PendingRequests, RequestIds, Requester, RequestSubject } from './ports.js';

/** How long a request is kept before it expires (decision 0056, Thomas). */
export const REQUEST_LIFETIME_MS = 7 * 24 * 60 * 60_000;

export type OpenRequest = (asked: { fleetId: FleetId; subject: RequestSubject; requester: Requester }) => Promise<PendingRequest>;

/**
 * Use case: an account asks for an outside party (decision 0056). The one
 * place a request opens, so who may ask is decided here alone (Thomas's
 * question A): a signed-in account in the fleet, for now. A second request
 * for the same client or server joins the one open.
 */
export function createOpenRequest(deps: { requests: PendingRequests; ids: RequestIds; clock: Clock }): OpenRequest {
  return ({ fleetId, subject, requester }) => {
    const now = deps.clock.now();
    return deps.requests.open({
      fleetId,
      requestId: deps.ids.newRequestId(),
      subject,
      requesters: [requester],
      askedAt: now,
      expiresAt: new Date(now.getTime() + REQUEST_LIFETIME_MS),
      state: 'pending',
      decidedBy: null,
      decidedAt: null,
      now,
    });
  };
}
