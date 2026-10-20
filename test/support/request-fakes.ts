import type { FleetId } from '@aeolus-fleet/common';

import type { PendingRequest, PendingRequests, Waiting, WaitingSeals } from '../../src/core/requests/ports.js';

/** Pending requests in memory, as the store keeps them: one open request per client or server in a fleet. */
export function memoryPendingRequests(): PendingRequests & { held: PendingRequest[]; told: Set<string> } {
  const held: PendingRequest[] = [];
  /** Each requester told its request's end, as `<request id> <account id>`. */
  const told = new Set<string>();
  const isOpen = (request: PendingRequest) => request.state === 'pending' || request.state === 'approving';
  const indexOf = (fleetId: FleetId, requestId: string) => held.findIndex((request) => request.fleetId === fleetId && request.requestId === requestId);
  const subjectOf = (request: Pick<PendingRequest, 'subject'>) => (request.subject.kind === 'client' ? `client:${request.subject.clientId}` : `server:${request.subject.url}`);
  const replace = (index: number, request: PendingRequest) => {
    held.splice(index, 1, request);
  };
  return {
    held,
    told,
    open: (asked) => {
      const { now, ...fresh } = asked;
      held.forEach((request, index) => {
        if (request.fleetId === fresh.fleetId && request.state === 'pending' && request.expiresAt <= now) {
          replace(index, { ...request, state: 'expired' });
        }
      });
      const index = held.findIndex((request) => request.fleetId === fresh.fleetId && isOpen(request) && subjectOf(request) === subjectOf(fresh));
      const open = held[index];
      if (open === undefined) {
        held.push(fresh);
        return Promise.resolve(fresh);
      }
      const [requester] = fresh.requesters;
      const isNew = requester !== undefined && !open.requesters.some((each) => each.accountId === requester.accountId);
      const joined = isNew ? { ...open, requesters: [...open.requesters, requester] } : open;
      replace(index, joined);
      return Promise.resolve(joined);
    },
    find: (fleetId, requestId) => Promise.resolve(held[indexOf(fleetId, requestId)]),
    latestAskedBy: (fleetId, { subject, accountId }) => {
      const asked = held.filter((request) => request.fleetId === fleetId && subjectOf(request) === subjectOf({ subject }) && request.requesters.some((each) => each.accountId === accountId));
      const latest = asked.reduce<PendingRequest | undefined>((last, request) => (last === undefined || request.askedAt >= last.askedAt ? request : last), undefined);
      return Promise.resolve(latest === undefined ? undefined : { request: latest, isTold: told.has(`${latest.requestId} ${accountId}`) });
    },
    markTold: (_fleetId, { requestId, accountId }) => {
      told.add(`${requestId} ${accountId}`);
      return Promise.resolve();
    },
    listOpen: (fleetId, now) => Promise.resolve(held.filter((request) => request.fleetId === fleetId && isOpen(request) && request.expiresAt > now)),
    claim: (fleetId, { requestId, now }) => {
      const index = indexOf(fleetId, requestId);
      const request = held[index];
      if (request?.state !== 'pending' || request.expiresAt <= now) {
        return Promise.resolve(false);
      }
      replace(index, { ...request, state: 'approving' });
      return Promise.resolve(true);
    },
    release: (fleetId, requestId) => {
      const index = indexOf(fleetId, requestId);
      const request = held[index];
      if (request?.state === 'approving') {
        replace(index, { ...request, state: 'pending' });
      }
      return Promise.resolve();
    },
    decide: (fleetId, { requestId, decision, from }) => {
      const index = indexOf(fleetId, requestId);
      const request = held[index];
      if (request === undefined || !from.includes(request.state)) {
        return Promise.resolve(false);
      }
      replace(index, { ...request, state: decision.outcome, decidedBy: decision.decidedBy, decidedAt: decision.decidedAt });
      return Promise.resolve(true);
    },
  };
}

/** Waitings sealed as a test reads them: numbered in the order they are made, opened from the same seals only. */
export function fakeWaitingSeals(): WaitingSeals & { held: Map<string, Waiting> } {
  const held = new Map<string, Waiting>();
  return {
    held,
    seal: (waiting) => {
      const sealed = `waiting-${String(held.size + 1)}`;
      held.set(sealed, waiting);
      return sealed;
    },
    open: (sealed) => held.get(sealed),
  };
}
