import type { OutcomeNotice, PendingRequest } from './ports.js';

/**
 * The outcomes to tell for a request that ended: one per requester with a
 * person ship, for a request for an outside MCP server only. A client's
 * requester is told by its browser, and one with no person ship on the
 * gateway's page (decision 0056).
 */
export function noticesOf(request: PendingRequest, ended: { outcome: OutcomeNotice['outcome']; partyName: string | null }): OutcomeNotice[] {
  const { subject } = request;
  if (subject.kind !== 'server') {
    return [];
  }
  return request.requesters.flatMap(({ accountId, personShipId }) =>
    personShipId === null ? [] : [{ fleetId: request.fleetId, requestId: request.requestId, accountId, personShipId, url: subject.url, outcome: ended.outcome, partyName: ended.partyName }],
  );
}

/** What the message to the person says (P5-2 a). */
export function textOf(notice: OutcomeNotice): string {
  const asked = `Your request for ${notice.url}`;
  switch (notice.outcome) {
    case 'approved':
      return `${asked} was approved: it is the outside party ${notice.partyName ?? notice.url}.`;
    case 'denied':
      return `${asked} was denied.`;
    case 'expired':
      return `${asked} expired after 7 days with no decision: ask again to try anew.`;
  }
}
