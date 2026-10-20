import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ApproveClientParty } from '../parties/approve-party.js';
import type { PartyStore } from '../parties/ports.js';

import type { Clock } from '../shared/clock.js';
import { err, ok, type Result } from '../shared/result.js';
import { issueCode, redirectWith } from './issue-code.js';
import type { AuthorizationCodes, OAuthSecrets } from './ports.js';
import type { AuthorizationRefusal, ReadAuthorization } from './read-authorization.js';

/**
 * Why argo's approval issued no code, beside the request's own refusals:
 * - needsParty: the client is no party yet, so argo names its party first;
 * - partyRefused: its party's proxy ship could not be commissioned or crewed, for the reason given.
 */
export type ApprovalRefusal = AuthorizationRefusal | { readonly kind: 'needsParty' } | { readonly kind: 'partyRefused'; readonly message: string };

export type ApproveAuthorization = (input: {
  fleetId: FleetId;
  request: Readonly<Record<string, string | undefined>>;
  isApproved: boolean;
  /** The party argo names for a client that is none yet. */
  newParty?: { requestId: string; name: string; ownerShipId: ShipId };
}) => Promise<Result<{ redirectTo: string }, ApprovalRefusal>>;

/**
 * Use case: argo, signed in to the console, approves or denies an MCP
 * client's authorization request for argo's fleet. The request is read
 * again, so nothing changed on the way is taken. A client is a party, its
 * own proxy ship: at its first approval argo names the party, and the
 * gateway commissions and crews its ship before any code is issued; later
 * approvals take that party (orchestrator-1 on aeolus-fleet#877, Q11). An
 * approval issues a code bound to the client, its party, its redirect URI,
 * its PKCE challenge and the resource; the client is sent back with it,
 * and with the issuer (RFC 9207).
 */
export function createApproveAuthorization(deps: {
  readAuthorization: ReadAuthorization;
  codes: AuthorizationCodes;
  secrets: OAuthSecrets;
  clock: Clock;
  issuer: string;
  parties: PartyStore;
  approveClientParty: ApproveClientParty;
}): ApproveAuthorization {
  /** The client's crewed party: the one it is, or the one argo names now. */
  const partyOf = async (fleetId: FleetId, approval: { clientId: string; newParty: Parameters<ApproveAuthorization>[0]['newParty'] }): Promise<Result<string, ApprovalRefusal>> => {
    const held = await deps.parties.findByClient(fleetId, approval.clientId);
    if (held?.state === 'crewed') {
      return ok(held.name);
    }
    const named = approval.newParty ?? (held ? { requestId: held.requestId, name: held.name, ownerShipId: held.ownerShipId } : undefined);
    if (named === undefined) {
      return err({ kind: 'needsParty' });
    }
    const party = await deps.approveClientParty({ operatorFleetId: fleetId, clientId: approval.clientId, ...named });
    if (!party.isOk) {
      return err({ kind: 'partyRefused', message: party.error.message });
    }
    if (party.value.state !== 'crewed') {
      return err({ kind: 'partyRefused', message: `The proxy ship of ${party.value.name} awaits crew: hand its secret over on the page of parties, then approve again` });
    }
    return ok(party.value.name);
  };

  return async ({ fleetId, request, isApproved, newParty }) => {
    const read = await deps.readAuthorization(request);
    if (!read.isOk) {
      return read;
    }
    const authorization = read.value;
    if (authorization.clientFleetId !== null && authorization.clientFleetId !== fleetId) {
      return err({ kind: 'invalidClient', message: `${authorization.clientName} is registered for another fleet` });
    }
    if (!isApproved) {
      return ok({ redirectTo: redirectWith(authorization.redirectUri, { error: 'access_denied', state: authorization.state, iss: deps.issuer }) });
    }
    const party = await partyOf(fleetId, { clientId: authorization.clientId, newParty });
    if (!party.isOk) {
      return party;
    }
    return ok({ redirectTo: await issueCode(deps, { fleetId, authorization, holder: { kind: 'party', party: party.value } }) });
  };
}
