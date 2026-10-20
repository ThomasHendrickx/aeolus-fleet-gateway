import type { FleetId } from '@aeolus-fleet/common';

import type { PendingRequest, PendingRequests } from '../../src/core/requests/ports.js';

/** Pending requests in memory, as the store keeps them: one open request per client or server in a fleet. */
export function memoryPendingRequests(): PendingRequests & { held: PendingRequest[] } {
  const held: PendingRequest[] = [];
  const isOpen = (request: PendingRequest) => request.state === 'pending' || request.state === 'approving';
  const indexOf = (fleetId: FleetId, requestId: string) => held.findIndex((request) => request.fleetId === fleetId && request.requestId === requestId);
  const subjectOf = (request: Pick<PendingRequest, 'subject'>) => (request.subject.kind === 'client' ? `client:${request.subject.clientId}` : `server:${request.subject.url}`);
  const replace = (index: number, request: PendingRequest) => {
    held.splice(index, 1, request);
  };
  return {
    held,
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
