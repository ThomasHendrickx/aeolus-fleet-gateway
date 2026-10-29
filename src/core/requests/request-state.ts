import type { PendingRequest, RequestState } from './ports.js';

/** Where a request stands by now: one still pending once its 7 days passed has expired, though the store marks it only when it is next opened. */
export function stateAt(request: PendingRequest, now: Date): RequestState {
  return request.state === 'pending' && request.expiresAt <= now ? 'expired' : request.state;
}

/** Whether a request ended with no proxy ship: denied, or expired. */
export function isRefused(request: PendingRequest, now: Date): boolean {
  const state = stateAt(request, now);
  return state === 'denied' || state === 'expired';
}
