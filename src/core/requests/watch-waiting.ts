import type { FleetId } from '@aeolus-fleet/common';

import type { PartyStore } from '../parties/ports.js';
import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { PendingRequests, WaitingSeals } from './ports.js';
import { isRefused } from './request-state.js';

/** Whether the browser that asked still waits, the fleet its request is in, the client asked for, and when the request expires. */
export interface WatchedWaiting {
  readonly fleetId: FleetId;
  readonly clientName: string;
  readonly isWaiting: boolean;
  readonly expiresAt: Date;
}

export type WatchWaitingRefusal = { readonly kind: 'unknownWaiting' } | { readonly kind: 'otherBrowser' };

export type WatchWaiting = (opened: { waiting: string; browserSecret: string | undefined }) => Promise<Result<WatchedWaiting, WatchWaitingRefusal>>;

/**
 * Use case: the waiting page follows its request live (decision 0056). It
 * reads whether the browser that asked still waits as readWaiting decides
 * it, with no side effect: no code is issued and nobody is told, as the page
 * then goes to its own address, where readWaiting answers.
 */
export function createWatchWaiting(deps: { waitings: WaitingSeals; requests: PendingRequests; parties: PartyStore; clock: Clock }): WatchWaiting {
  return async ({ waiting: sealed, browserSecret }) => {
    const waiting = deps.waitings.open(sealed);
    if (waiting === undefined) {
      return err({ kind: 'unknownWaiting' });
    }
    if (browserSecret !== waiting.browserSecret) {
      return err({ kind: 'otherBrowser' });
    }
    const request = await deps.requests.find(waiting.fleetId, waiting.requestId);
    if (request === undefined) {
      return err({ kind: 'unknownWaiting' });
    }
    const clientId = waiting.request.client_id ?? '';
    const watched = { fleetId: request.fleetId, clientName: request.subject.kind === 'client' ? request.subject.clientName : clientId, expiresAt: request.expiresAt };
    if (isRefused(request, deps.clock.now())) {
      return ok({ ...watched, isWaiting: false });
    }
    const party = request.state === 'approved' ? await deps.parties.findByClient(request.fleetId, clientId) : undefined;
    return ok({ ...watched, isWaiting: party?.state !== 'crewed' });
  };
}
