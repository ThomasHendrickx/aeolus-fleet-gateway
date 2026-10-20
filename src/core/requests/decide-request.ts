import type { ShipId } from '@aeolus-fleet/common';

import type { Actor } from '../actors/authenticate-actor.js';
import type { ApproveClientParty, ApproveParty, ApprovePartyRefusal } from '../parties/approve-party.js';
import type { ShownParty } from '../parties/shown-party.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { McpServerCredential } from '../vault/credential.js';
import type { DecidedBy, PendingRequest, PendingRequests } from './ports.js';

/** The scope the gateway declares for approving outside parties (decision 0056). */
export const APPROVING_SCOPE = 'gateway:approve';

/** The scopes every app ship gets (decision 0046), so an approver need not hold them to grant them. */
const EVERY_APP_SHIP_SCOPES = new Set(['messages:send', 'messages:receive']);

/** An approval: the proxy ship's name, its owner (a person ship) and its scopes; for a server, its credential and how many calls it takes at once. */
export interface Approval {
  readonly kind: 'approve';
  readonly party: { readonly name: string; readonly ownerShipId: ShipId; readonly scopes: readonly string[] };
  readonly server?: { readonly credential: McpServerCredential; readonly concurrencyLimit: number };
}

export type Decision = Approval | { readonly kind: 'deny' };

export type DecideRefusal =
  | DomainError<'NOT_AN_APPROVER' | 'NO_SUCH_REQUEST' | 'ALREADY_DECIDED' | 'EXPIRED' | 'SCOPE_NOT_HELD' | 'SERVER_DETAILS_MISSING' | 'CLIENT_HAS_PARTY'>
  | ApprovePartyRefusal;

export type DecideRequest = (input: { actor: Actor; requestId: string; decision: Decision }) => Promise<Result<{ state: 'approved' | 'denied'; party: ShownParty | null }, DecideRefusal>>;

function decidedByOf(actor: Actor): DecidedBy {
  return actor.kind === 'ship' ? { kind: 'ship', shipId: actor.shipId } : { kind: actor.kind };
}

/**
 * Use case: an actor holding gateway:approve decides a pending request
 * (decision 0056). The first decision counts. Approving grants only scopes
 * the approver holds; the gateway, as its own ship, commissions the proxy
 * ship with them, and the fleet refuses any its ship does not hold. While
 * the proxy ship is commissioned the request is approving, under its id as
 * the commission's key, so an approval tried again after the fleet did not
 * answer commissions one ship; a refused commission gives the request back
 * as pending, undecided.
 */
export function createDecideRequest(deps: { requests: PendingRequests; approveParty: ApproveParty; approveClientParty: ApproveClientParty; clock: Clock }): DecideRequest {
  const approve = (request: PendingRequest, approval: Approval) => {
    const { name, ownerShipId, scopes } = approval.party;
    const granted = scopes.filter((scope) => !EVERY_APP_SHIP_SCOPES.has(scope));
    const party = { operatorFleetId: request.fleetId, requestId: request.requestId, name, ownerShipId, scopes: granted };
    if (request.subject.kind === 'client') {
      return deps.approveClientParty({ ...party, clientId: request.subject.clientId });
    }
    return approval.server === undefined
      ? Promise.resolve(refuse('SERVER_DETAILS_MISSING', 'Adding an outside MCP server needs its credential and how many calls it takes at once'))
      : deps.approveParty({ ...party, url: request.subject.url, ...approval.server });
  };

  return async ({ actor, requestId, decision }) => {
    if (!actor.scopes.includes(APPROVING_SCOPE)) {
      return refuse('NOT_AN_APPROVER', `Deciding requests needs ${APPROVING_SCOPE}`);
    }
    const request = await deps.requests.find(actor.fleetId, requestId);
    if (request === undefined) {
      return refuse('NO_SUCH_REQUEST', `No request ${requestId} in this fleet`);
    }
    const now = deps.clock.now();
    if (request.state === 'approved' || request.state === 'denied') {
      return refuse('ALREADY_DECIDED', `This request was ${request.state} already`);
    }
    if (request.state === 'expired' || (request.state === 'pending' && request.expiresAt <= now)) {
      return refuse('EXPIRED', 'This request expired after 7 days: a new request asks anew');
    }
    const decided = { outcome: decision.kind === 'deny' ? ('denied' as const) : ('approved' as const), decidedBy: decidedByOf(actor), decidedAt: now };
    if (decision.kind === 'deny') {
      const isDenied = await deps.requests.decide(actor.fleetId, { requestId, from: ['pending'], decision: decided });
      return isDenied ? ok({ state: 'denied', party: null }) : refuse('ALREADY_DECIDED', 'This request is decided already');
    }
    const notHeld = decision.party.scopes.find((scope) => !EVERY_APP_SHIP_SCOPES.has(scope) && !actor.scopes.includes(scope));
    if (notHeld !== undefined) {
      return refuse('SCOPE_NOT_HELD', `You may grant only scopes you hold: not ${notHeld}`);
    }
    if (request.subject.kind === 'server' && decision.server === undefined) {
      return refuse('SERVER_DETAILS_MISSING', 'Adding an outside MCP server needs its credential and how many calls it takes at once');
    }
    if (request.state === 'pending' && !(await deps.requests.claim(actor.fleetId, { requestId, now }))) {
      return refuse('ALREADY_DECIDED', 'This request is decided already');
    }
    const party = await approve(request, decision);
    if (!party.isOk) {
      if (party.error.kind !== 'FLEET_UNAVAILABLE') {
        await deps.requests.release(actor.fleetId, requestId);
      }
      return party;
    }
    await deps.requests.decide(actor.fleetId, { requestId, from: ['approving'], decision: decided });
    return ok({ state: 'approved', party: party.value });
  };
}
