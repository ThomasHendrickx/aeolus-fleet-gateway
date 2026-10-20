import { issueCode, redirectWith } from '../oauth/issue-code.js';
import type { AuthorizationCodes, OAuthSecrets } from '../oauth/ports.js';
import type { AuthorizationRefusal, ReadAuthorization } from '../oauth/read-authorization.js';
import type { PartyStore } from '../parties/ports.js';
import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import type { PendingRequests, WaitingSeals } from './ports.js';
import { isRefused } from './request-state.js';

/** What the waiting page shows: the client still waits, or where it is sent back now. */
export type WaitingAnswer = { readonly kind: 'waiting'; readonly clientName: string } | { readonly kind: 'answered'; readonly redirectTo: string };

/**
 * Why a waiting gives the client nothing, beside its request's own refusals:
 * - unknownWaiting: the gateway sealed no such waiting, or its request is forgotten;
 * - otherBrowser: the browser does not hold the secret of the one that asked.
 */
export type WaitingRefusal = AuthorizationRefusal | { readonly kind: 'unknownWaiting' } | { readonly kind: 'otherBrowser' };

export type ReadWaiting = (opened: { waiting: string; browserSecret: string | undefined }) => Promise<Result<WaitingAnswer, WaitingRefusal>>;

/**
 * Use case: the browser that asked for an outside MCP client looks again
 * (decision 0056). The client's request is read again, so nothing changed on
 * the way is taken. Approved, and its party crewed, the client is sent back
 * with its party's code; denied or expired, with access_denied, the account
 * told; otherwise it waits.
 */
export function createReadWaiting(deps: {
  waitings: WaitingSeals;
  readAuthorization: ReadAuthorization;
  requests: PendingRequests;
  parties: PartyStore;
  codes: AuthorizationCodes;
  secrets: OAuthSecrets;
  clock: Clock;
  issuer: string;
}): ReadWaiting {
  return async ({ waiting: sealed, browserSecret }) => {
    const waiting = deps.waitings.open(sealed);
    if (waiting === undefined) {
      return err({ kind: 'unknownWaiting' });
    }
    if (browserSecret !== waiting.browserSecret) {
      return err({ kind: 'otherBrowser' });
    }
    const { fleetId, requestId, accountId } = waiting;
    const request = await deps.requests.find(fleetId, requestId);
    if (request === undefined) {
      return err({ kind: 'unknownWaiting' });
    }
    const read = await deps.readAuthorization(waiting.request);
    if (!read.isOk) {
      return read;
    }
    const authorization = read.value;
    if (isRefused(request, deps.clock.now())) {
      await deps.requests.markTold(fleetId, { requestId, accountId });
      return ok({ kind: 'answered', redirectTo: redirectWith(authorization.redirectUri, { error: 'access_denied', state: authorization.state, iss: deps.issuer }) });
    }
    const party = request.state === 'approved' ? await deps.parties.findByClient(fleetId, authorization.clientId) : undefined;
    if (party?.state !== 'crewed') {
      return ok({ kind: 'waiting', clientName: authorization.clientName });
    }
    return ok({ kind: 'answered', redirectTo: await issueCode(deps, { fleetId, authorization, holder: { kind: 'party', party: party.name } }) });
  };
}
