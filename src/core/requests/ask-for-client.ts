import type { FleetId } from '@aeolus-fleet/common';

import { issueCode, redirectWith } from '../oauth/issue-code.js';
import type { AuthorizationCodes, OAuthSecrets } from '../oauth/ports.js';
import type { AuthorizationRequest } from '../oauth/read-authorization.js';
import type { PartyStore } from '../parties/ports.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { OpenRequest } from './open-request.js';
import type { PendingRequests, Requester, WaitingSeals } from './ports.js';
import { isRefused } from './request-state.js';

/** What asking answers: where the client is sent back now, or the sealed waiting the browser waits on. */
export type ClientAnswer = { readonly kind: 'answered'; readonly redirectTo: string } | { readonly kind: 'waiting'; readonly waiting: string };

export type AskForClient = (asked: {
  fleetId: FleetId;
  requester: Requester;
  authorization: AuthorizationRequest;
  /** The client's request as it came, read again while the browser waits. */
  request: Readonly<Record<string, string | undefined>>;
  browserSecret: string;
}) => Promise<Result<ClientAnswer, DomainError<'OUTSIDE_PARTIES_OFF'>>>;

/**
 * Use case: an account of the fleet, signed in, asks for access for an
 * outside MCP client (decision 0056, Thomas's question A). A client that is
 * a party already gets its party's code at once. A deny or an expired
 * request the account asked for ends its next try with access_denied, once;
 * otherwise the account opens a request, or joins the one pending, and its
 * browser waits for the decision. While the fleet's outside parties are off,
 * nobody asks (interop I-3).
 */
export function createAskForClient(deps: {
  parties: PartyStore;
  requests: PendingRequests;
  openRequest: OpenRequest;
  servesOutsideParties: (fleetId: FleetId) => Promise<boolean>;
  waitings: WaitingSeals;
  codes: AuthorizationCodes;
  secrets: OAuthSecrets;
  clock: Clock;
  issuer: string;
}): AskForClient {
  return async ({ fleetId, requester, authorization, request, browserSecret }) => {
    if (!(await deps.servesOutsideParties(fleetId))) {
      return refuse('OUTSIDE_PARTIES_OFF', "This fleet's outside parties are off: nobody asks for an outside MCP client");
    }
    const party = await deps.parties.findByClient(fleetId, authorization.clientId);
    if (party?.state === 'crewed') {
      return ok({ kind: 'answered', redirectTo: await issueCode(deps, { fleetId, authorization, holder: { kind: 'party', party: party.name } }) });
    }
    const subject = { kind: 'client', clientId: authorization.clientId, clientName: authorization.clientName } as const;
    const latest = await deps.requests.latestAskedBy(fleetId, { subject, accountId: requester.accountId });
    if (latest !== undefined && !latest.isTold && isRefused(latest.request, deps.clock.now())) {
      await deps.requests.markTold(fleetId, { requestId: latest.request.requestId, accountId: requester.accountId });
      return ok({ kind: 'answered', redirectTo: redirectWith(authorization.redirectUri, { error: 'access_denied', state: authorization.state, iss: deps.issuer }) });
    }
    const opened = await deps.openRequest({ fleetId, subject, requester });
    return ok({ kind: 'waiting', waiting: deps.waitings.seal({ fleetId, requestId: opened.requestId, accountId: requester.accountId, browserSecret, request }) });
  };
}
