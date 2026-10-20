import type { FleetId } from '@aeolus-fleet/common';

import type { ShipId } from '@aeolus-fleet/common';

import type { OutcomeNotice, OutcomeNotices, OwnerQuestion, OwnerQuestions, PendingRequest, PendingRequests, Waiting, WaitingSeals } from '../../src/core/requests/ports.js';
import { stateAt } from '../../src/core/requests/request-state.js';
import { err, ok } from '../../src/core/shared/result.js';

/** Pending requests in memory, as the store keeps them: one open request per client or server in a fleet. */
export function memoryPendingRequests(): PendingRequests & { held: PendingRequest[]; told: Set<string>; notices: (OutcomeNotice & { isEnded: boolean })[]; outcomeNotices: OutcomeNotices } {
  const held: PendingRequest[] = [];
  /** The outcomes to tell, written with each decision or expiry. */
  const notices: (OutcomeNotice & { isEnded: boolean })[] = [];
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
    notices,
    outcomeNotices: {
      listUnended: (limit) => Promise.resolve(notices.filter((notice) => !notice.isEnded).slice(0, limit)),
      end: ({ fleetId, requestId, accountId }) => {
        const index = notices.findIndex((notice) => notice.fleetId === fleetId && notice.requestId === requestId && notice.accountId === accountId);
        const notice = notices[index];
        if (notice !== undefined) {
          notices.splice(index, 1, { ...notice, isEnded: true });
        }
        return Promise.resolve();
      },
    },
    listDue: (now) => Promise.resolve(held.filter((request) => request.state === 'pending' && request.expiresAt <= now)),
    expire: (fleetId, { requestId, now, notices: told }) => {
      const index = indexOf(fleetId, requestId);
      const request = held[index];
      if (request?.state !== 'pending' || request.expiresAt > now) {
        return Promise.resolve(false);
      }
      replace(index, { ...request, state: 'expired' });
      notices.push(...told.map((notice) => ({ ...notice, isEnded: false })));
      return Promise.resolve(true);
    },
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
    decide: (fleetId, { requestId, decision, from, notices: told }) => {
      const index = indexOf(fleetId, requestId);
      const request = held[index];
      if (request === undefined || !from.includes(request.state)) {
        return Promise.resolve(false);
      }
      replace(index, { ...request, state: decision.outcome, decidedBy: decision.decidedBy, decidedAt: decision.decidedAt });
      notices.push(...told.map((notice) => ({ ...notice, isEnded: false })));
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

/** The questions to the gateway's owner in memory, beside the requests they are about. */
export function memoryOwnerQuestions(requests: { held: PendingRequest[] }): OwnerQuestions & { held: OwnerQuestion[] } {
  const held: OwnerQuestion[] = [];
  const questionOf = (request: PendingRequest) => held.find((question) => question.fleetId === request.fleetId && question.requestId === request.requestId);
  const isOpenAt = (request: PendingRequest, now: Date) => {
    const state = stateAt(request, now);
    return state === 'pending' || state === 'approving';
  };
  const replace = ({ fleetId, requestId }: { fleetId: string; requestId: string }, change: Partial<OwnerQuestion>) => {
    const index = held.findIndex((question) => question.fleetId === fleetId && question.requestId === requestId);
    const question = held[index];
    if (question !== undefined) {
      held.splice(index, 1, { ...question, ...change });
    }
  };
  return {
    held,
    listToAsk: (now, limit) =>
      Promise.resolve(
        requests.held
          .filter((request) => isOpenAt(request, now) && (questionOf(request)?.askedAt ?? null) === null)
          .slice(0, limit)
          .map((request) => ({ request, questionId: questionOf(request)?.questionId ?? null })),
      ),
    keep: (fleetId, { requestId, questionId }) => {
      const kept = held.find((question) => question.fleetId === fleetId && question.requestId === requestId);
      if (kept !== undefined) {
        return Promise.resolve(kept.questionId);
      }
      held.push({ fleetId, requestId, questionId, askedShipId: null, askedAt: null, withdrawnAt: null });
      return Promise.resolve(questionId);
    },
    markAsked: (fleetId, { requestId, askedShipId, at }) => {
      replace({ fleetId, requestId }, { askedShipId, askedAt: at });
      return Promise.resolve();
    },
    listToWithdraw: (now, limit) =>
      Promise.resolve(
        held
          .filter((question) => {
            const request = requests.held.find((each) => each.fleetId === question.fleetId && each.requestId === question.requestId);
            return question.askedShipId !== null && question.withdrawnAt === null && (request === undefined || !isOpenAt(request, now));
          })
          .slice(0, limit),
      ),
    markWithdrawn: (fleetId, { requestId, at }) => {
      replace({ fleetId, requestId }, { withdrawnAt: at });
      return Promise.resolve();
    },
  };
}

/** Who owns each ship, as the fleet answers it; a ship not listed is unknown. */
export function fakeOwners(owners: Record<string, ShipId | null>, answer: { isAnswering: boolean } = { isAnswering: true }) {
  return {
    ownerOf: (_crewToken: string, shipId: ShipId) =>
      Promise.resolve(
        !answer.isAnswering
          ? err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' })
          : shipId in owners
            ? ok(owners[shipId] ?? null)
            : err({ code: 'NOT_FOUND', message: `No ship ${shipId}` }),
      ),
  };
}
